export const privatePath = (name: string) =>
  name
    .split(/[\\/]/)
    .some(
      (p) =>
        p.startsWith(".") ||
        /^(node_modules|dist|build|target|bin|obj|vendor|coverage|venv|__pycache__|site-packages|secrets?|credentials?)$/i.test(
          p,
        ) ||
        /(^|[._-])(secret|credential|private[-_]?key)([._-]|$)|\.local\.|\.(dpapi|pem|key|pfx|p12|db|sqlite|log)$/i.test(
          p,
        ),
    );
export const secretText = (content: string) =>
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:sk-|ghp_|gsk_|github_pat_)[a-zA-Z0-9_-]{20,}|\bBearer\s+[\w.~-]{12,}|\b(?:[A-Z0-9_]*API[_-]?KEY|PASSWORD|CLIENT[_-]?SECRET|(?:ACCESS|REFRESH|AUTH)[_-]?TOKEN)["']?\s*[:=]\s*["'][^"'\r\n]{8,}["']/i.test(
    content,
  );

// Structured exports must inspect the field/value pair, not just isolated strings.
// Keep schema keys intact; replacing names could corrupt records or hide evidence.
export const redactedCredential = "[redacted for portable export]";
export const credentialField = (key: string, value: unknown) =>
  /^(?:[A-Z0-9_]*API[_-]?KEY|PASSWORD|CLIENT[_-]?SECRET|(?:ACCESS|REFRESH|AUTH)[_-]?TOKEN)$/i.test(
    key,
  ) &&
  typeof value === "string" &&
  value.length >= 8 &&
  value !== redactedCredential;
