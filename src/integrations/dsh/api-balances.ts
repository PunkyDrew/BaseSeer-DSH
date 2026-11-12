// Balance endpoints are provider-specific. Never send a route's credential to
// an inferred compatible gateway or return credentials/account identities.
const services = {
  deepseek: {
    bases: ["https://api.deepseek.com", "https://api.deepseek.com/v1"],
    endpoint: "https://api.deepseek.com/user/balance",
    reference: "DEEPSEEK_API_KEY",
    source: "https://api-docs.deepseek.com/api/get-user-balance",
  },
  openrouter: {
    bases: ["https://openrouter.ai/api/v1"],
    endpoint: "https://openrouter.ai/api/v1/key",
    reference: "OPENROUTER_API_KEY",
    source:
      "https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key",
  },
};
const unknown = (provider: string, reason: string) => ({
  provider,
  status: "unavailable",
  reason,
  balances: [],
});
function environmentValue(ctx: any, name: string) {
  const environment = ctx.get?.("launchEnvironment");
  return environment ? environment.get(name)?.value : process.env[name];
}
function amount(value: unknown) {
  if (
    typeof value !== "number" &&
    !(typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value))
  )
    throw Error("Invalid amount");
  const result = Number(value);
  if (!Number.isFinite(result)) throw Error("Invalid amount");
  return result;
}

export function parseApiBalance(kind: keyof typeof services, body: any) {
  if (kind === "deepseek") {
    if (
      typeof body?.is_available !== "boolean" ||
      !Array.isArray(body.balance_infos) ||
      !body.balance_infos.length
    )
      throw Error("Invalid balance");
    const balances = body.balance_infos.map((b: any) => {
      if (!["USD", "CNY"].includes(b.currency)) throw Error("Invalid currency");
      return {
        kind: "account-credit",
        currency: b.currency,
        remaining: amount(b.total_balance),
      };
    });
    if (new Set(balances.map((b: any) => b.currency)).size !== balances.length)
      throw Error("Duplicate currency");
    return { available: body.is_available, balances };
  }
  const data = body?.data;
  // An unlimited key is not an unlimited account balance.
  if (
    !data ||
    !(
      data.limit === null ||
      (typeof data.limit === "number" &&
        Number.isFinite(data.limit) &&
        data.limit >= 0)
    )
  )
    throw Error("Invalid key allowance");
  return {
    balances:
      data.limit === null
        ? []
        : [
            {
              kind: "key-allowance",
              currency: "USD",
              remaining: amount(data.limit_remaining),
              ...(typeof data.limit_reset === "string" &&
              ["daily", "weekly", "monthly"].includes(data.limit_reset)
                ? { reset: data.limit_reset }
                : {}),
            },
          ],
  };
}

// Inspect only known adapter configuration contracts through host services.
// Unknown plugins remain discoverable but require their own billing adapter.
function billingRoute(ctx: any, provider: string) {
  const entry = ctx.llm
    .listConfigurableProviders?.()
    .find((e: any) => e.provider === provider);
  if (
    !entry ||
    entry.error ||
    !["llm-deepseek", "llm-pi-ai"].includes(entry.settingsNs)
  )
    return;
  let profile = ctx.get?.("settings")?.describe({ redactSecrets: true })
    .find((descriptor: any) => descriptor.ns === entry.settingsNs)?.value;
  for (const key of entry.settingsPath) profile = profile?.[key];
  if (!profile) return;
  let base = profile.baseURL;
  if (entry.settingsNs === "llm-deepseek")
    base ??=
      environmentValue(ctx, "DEEPSEEK_BASE_URL") ?? services.deepseek.bases[0];
  else if (!base && Object.hasOwn(services, provider))
    base = services[provider as keyof typeof services].bases[0];
  if (typeof base !== "string") return;
  base = base.replace(/\/$/, "");
  const match = Object.entries(services).find(([, service]) =>
    service.bases.includes(base),
  );
  if (!match) return;
  // A route with per-model endpoints/headers cannot claim one account balance.
  const models = [
    ...(profile.models ?? []),
    ...Object.values(profile.modelOverrides ?? {}),
  ] as any[];
  if (
    (profile.headers && Object.keys(profile.headers).length) ||
    models.some((m) => m.baseUrl || m.baseURL || m.headers)
  )
    return;
  return {
    kind: match[0] as keyof typeof services,
    service: match[1],
    reference:
      profile.apiKeyEnv ??
      (entry.settingsNs === "llm-deepseek"
        ? services.deepseek.reference
        : undefined),
  };
}

export async function readApiBalances(
  ctx: any,
  providers: string[],
  fetcher: typeof fetch = fetch,
) {
  const entries = await Promise.all(
    [...new Set(providers)].map(async (provider) => {
      try {
        const route = billingRoute(ctx, provider);
        if (!route)
          return unknown(
            provider,
            "No supported balance lookup for this route's configuration.",
          );
        const credentials = ctx.get?.("credentials");
        const resolve = async (ref: string) => {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) return;
          return credentials
            ? (await credentials.resolve(ref))?.value
            : environmentValue(ctx, ref);
        };
        let key: string | undefined;
        if (route.reference) key = await resolve(route.reference);
        else {
          // Match pi-ai's stored API-key precedence; OAuth/ambient records are
          // deliberately not interpreted as bearer API keys.
          const record = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(provider)
            ? await credentials?.readRecord(`llm-pi-ai/${provider}`)
            : undefined;
          if (record) {
            if (
              record.kind !== "api-key" ||
              (record.env && Object.keys(record.env).length)
            )
              return unknown(
                provider,
                "This route's authentication does not expose a supported API balance lookup.",
              );
            key = record.key;
          } else if (provider === route.kind)
            key = await resolve(route.service.reference);
        }
        if (typeof key !== "string" || !key.trim())
          return unknown(provider, "API balance credentials are unavailable.");
        const signal = AbortSignal.timeout(6000);
        async function get(url: string) {
          const response = await fetcher(url, {
            method: "GET",
            redirect: "error",
            signal,
            headers: { authorization: `Bearer ${key!.trim()}` },
          });
          if (!response.ok) throw Error("Balance lookup failed");
          return response.json();
        }
        const result = parseApiBalance(
          route.kind,
          await get(route.service.endpoint),
        );
        let reason;
        if (route.kind === "openrouter") {
          // Account credits may require a management key. Never acquire one or
          // broaden permissions; retain the ordinary key's allowance separately.
          try {
            const body = await get("https://openrouter.ai/api/v1/credits");
            result.balances.push({
              kind: "account-credit",
              currency: "USD",
              remaining: amount(
                amount(body.data.total_credits) - amount(body.data.total_usage),
              ),
            });
          } catch {
            reason =
              "Account credits unavailable with this credential; any key allowance shown is a separate limit.";
          }
        }
        return {
          provider,
          status: result.balances.length ? "reported" : "unavailable",
          source: route.service.source,
          ...result,
          ...(reason ? { reason } : {}),
          ...(route.kind === "openrouter"
            ? {
                limits:
                  "Key allowance is not account credit. Free models and BYOK can have different billing; amounts alone do not establish model availability.",
              }
            : {}),
        };
      } catch {
        return unknown(
          provider,
          "API balance could not be read. Availability and remaining funds are unknown.",
        );
      }
    }),
  );
  return { retrievedAt: new Date().toISOString(), providers: entries };
}
