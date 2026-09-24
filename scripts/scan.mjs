import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const ignore = new Set([
  "node_modules",
  ".next",
  ".git",
  "var",
  "test-results",
  "playwright-report",
]);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|sk_live_[A-Za-z0-9]{20,})\b/,
  /(?:PAYMENT_API_KEY|BOSTA_API_KEY|PAYMOB_SECRET_KEY|PAYMOB_HMAC_SECRET|SUPABASE_SERVICE_ROLE_KEY|SESSION_SECRET|CRON_SECRET|EMAIL_API_KEY)\s*=\s*["']?[A-Za-z0-9+/=_-]{24,}/,
];
let checked = 0;
const findings = [];
async function scan(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (ignore.has(item.name)) continue;
    const name = path.join(dir, item.name);
    if (item.isDirectory()) {
      await scan(name);
      continue;
    }
    if (item.name.startsWith(".env") && item.name !== ".env.example") {
      findings.push(name + ": environment file must not be packaged");
      continue;
    }
    if (
      !/\.(?:tsx?|m?js|json|sql|ya?ml|md|example)$/.test(name) ||
      /package-lock\.json$/.test(name) ||
      name === "scripts/scan.mjs"
    )
      continue;
    const text = await readFile(name, "utf8");
    checked++;
    for (const [i, line] of text.split("\n").entries())
      if (patterns.some((p) => p.test(line)))
        findings.push(`${name}:${i + 1}: possible secret`);
  }
}
await scan(".");
console.log(JSON.stringify({ checked, findings }));
if (findings.length) process.exitCode = 1;
