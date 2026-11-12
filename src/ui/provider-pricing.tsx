import React, { useEffect, useState } from "react";
import { deepSeekPricing } from "../domain/deepseek-pricing.ts";

export function PricingStatus({ value }: { value: any }) {
  const [p, setPricing] = useState(value.pricing);
  useEffect(() => {
    const received = performance.now(),
      hostTime = Date.parse(value.pricing.checkedAt);
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      const now = hostTime + performance.now() - received;
      const next = deepSeekPricing(now);
      setPricing(next);
      timer = setTimeout(
        refresh,
        Math.max(
          100,
          Math.min(
            60000,
            Date.parse(next.nextChange ?? "") - now + 100 || 60000,
          ),
        ),
      );
    };
    refresh();
    return () => clearTimeout(timer);
  }, [value.pricing.checkedAt]);
  const label =
    p.period === "peak"
      ? "Peak pricing now"
      : p.period === "off-peak"
        ? "Off-peak pricing now"
        : "Pricing period unverified";
  const date = (s: string) =>
    new Date(s).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  return (
    <div className="bp-price-status">
      <p role="status">
        <strong>{label}</strong>
        {value.blockPeak
          ? p.period === "off-peak"
            ? " · requests allowed"
            : " · requests blocked"
          : " · peak block off"}
      </p>
      {p.nextChange && (
        <p>
          {p.nextPeriod === "peak"
            ? "Peak starts"
            : p.nextPeriod === "off-peak"
              ? "Off-peak starts"
              : "Calendar verification needed"}
          : {date(p.nextChange)}.
        </p>
      )}
      {p.period === "unknown" && (
        <p>
          The holiday calendar needs an update. With the block on, possible peak
          hours stay blocked.
        </p>
      )}
      <details>
        <summary>Peak and off-peak prices</summary>
        <p>USD per 1 million tokens. Off-peak is half the peak rate.</p>
        {p.rates.map((r: any) => (
          <div key={r.model}>
            <h4>{r.model}</h4>
            <table>
              <thead>
                <tr>
                  <th>Tokens</th>
                  <th>Off-peak</th>
                  <th>Peak</th>
                </tr>
              </thead>
              <tbody>
                {["Cached input", "Uncached input", "Output"].map(
                  (label, i) => (
                    <tr key={label}>
                      <th>{label}</th>
                      <td>${r.offPeak[i]}</td>
                      <td>${r.peak[i]}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        ))}
        <p>
          Peak: Monday–Friday, 01:00–04:00 and 06:00–10:00 UTC. Weekends and
          Chinese public holidays are off-peak.
        </p>
        <p>
          Flash aliases use Flash rates. Other models or gateways need their own
          pricing. Published rates checked {p.asOf}; these are estimates, not
          your bill.
        </p>
        <p>
          <a href={p.source} target="_blank" rel="noopener noreferrer">
            DeepSeek pricing
          </a>{" "}
          ·{" "}
          <a href={p.holidaySource} target="_blank" rel="noopener noreferrer">
            2026 holiday calendar
          </a>
        </p>
      </details>
    </div>
  );
}

export function ProviderPricing({
  provider,
  call,
}: {
  provider: any;
  call: (op: string, payload: any) => Promise<any>;
}) {
  const [value, setValue] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const v = await call("provider-pricing", {
          command: { action: "read", provider: provider.provider },
        });
        if (!live) return;
        setValue((prior: any) =>
          prior && prior.revision > v.revision ? prior : v,
        );
        const until =
          Date.parse(v.pricing.nextChange) - Date.parse(v.pricing.checkedAt);
        timer = setTimeout(
          refresh,
          Math.max(250, Math.min(60000, until + 100 || 60000)),
        );
      } catch {
        if (live) {
          setError(
            "Pricing settings could not be refreshed. Reopen Settings to retry.",
          );
          timer = setTimeout(refresh, 60000);
        }
      }
    };
    void refresh();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [provider.provider]);
  if (!value && !error) return <p>Loading price protection…</p>;
  if (value && !value.route) return null;
  const save = async (blockPeak: boolean) => {
    setBusy(true);
    setError("");
    try {
      setValue(
        await call("provider-pricing", {
          command: {
            action: "save",
            provider: provider.provider,
            expected: value.revision,
            blockPeak,
          },
        }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="bp-provider-pricing"
      aria-label="DeepSeek price protection"
    >
      <h3>DeepSeek price protection</h3>
      {value && (
        <>
          <label className="bp-price-toggle">
            <input
              type="checkbox"
              role="switch"
              checked={value.blockPeak}
              disabled={busy}
              onChange={(e) => void save(e.target.checked)}
            />{" "}
            Block DeepSeek API during peak hours
          </label>
          <p>
            {busy
              ? "Saving…"
              : "Applies to new requests across chats and workers, including retries. Requests already in progress can finish."}
          </p>
          {value.route === "custom" && (
            <p>
              This DeepSeek endpoint has unverified pricing. Protection still
              blocks the published peak windows.
            </p>
          )}
          <PricingStatus value={value} />
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <style>{`.bp-provider-pricing{color:var(--dsw-alias-label-primary);border-top:1px solid var(--dsw-alias-border-l3);padding-top:14px;min-width:0;font-size:14px;line-height:1.6}.bp-provider-pricing h3{font-size:14px;margin:0 0 8px}.bp-provider-pricing p{margin:6px 0;max-width:72ch}.bp-price-toggle{display:flex;align-items:center;gap:10px;min-height:44px;cursor:pointer;font-weight:600}.bp-price-toggle input{width:20px;height:20px;flex:none;accent-color:var(--dsw-alias-button-primary-fill)}.bp-provider-pricing summary{cursor:pointer;padding:8px 0;min-height:44px}.bp-price-status table{border-collapse:collapse;width:100%;max-width:500px;font-variant-numeric:tabular-nums}.bp-price-status td,.bp-price-status th{text-align:left;padding:6px;border-bottom:1px solid var(--dsw-alias-border-l3,#9bafb8)}.bp-provider-pricing a{text-decoration:underline;text-underline-offset:3px}.bp-provider-pricing :focus-visible{outline:2px solid currentColor;outline-offset:3px}`}</style>
    </section>
  );
}
