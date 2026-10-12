declare const __MANAGED_OPENAI__: string;
declare const __MANAGED_COMPOSIO__: string;
declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;
declare const __WEB_URL__: string;

const SALT = "dashy-pastel-salt";
function unscramble(b64: string) {
  if (!b64) return undefined;
  const bytes = Buffer.from(b64, "base64");
  const out = Buffer.from([...bytes].map((b, i) => b ^ SALT.charCodeAt(i % SALT.length))).toString("utf8");
  return out || undefined;
}

/** Keys the app ships with, so customers never need their own. */
export function managedKeys(): Partial<Record<"openai" | "composio", string>> {
  if (process.env.DASH_IGNORE_ENV) return {};
  return {
    openai: unscramble(typeof __MANAGED_OPENAI__ === "string" ? __MANAGED_OPENAI__ : ""),
    composio: unscramble(typeof __MANAGED_COMPOSIO__ === "string" ? __MANAGED_COMPOSIO__ : ""),
  };
}

/** Cloud (accounts, credits, billing). Public values; absent in local dev builds, which then skip sign-in and gating. */
export function cloudConfig() {
  const pick = (d: string, env: string) => process.env[env] || (typeof d === "string" && d ? d : undefined);
  return {
    url: pick(typeof __SUPABASE_URL__ === "string" ? __SUPABASE_URL__ : "", "SUPABASE_URL"),
    anonKey: pick(typeof __SUPABASE_ANON_KEY__ === "string" ? __SUPABASE_ANON_KEY__ : "", "SUPABASE_ANON_KEY"),
    webUrl: pick(typeof __WEB_URL__ === "string" ? __WEB_URL__ : "", "WEB_URL") ?? "https://mydashie.com",
  };
}
