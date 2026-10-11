// Launches the packaged .app from release/ with an isolated user-data dir, waits for the
// window, screenshots it, and reports console errors. Usage: node scripts/check-packaged.mjs
import { _electron as electron } from "playwright-core";
import { mkdtempSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const release = join(root, "release");
const mac = readdirSync(release).find((d) => d === "mac-arm64") ?? readdirSync(release).find((d) => d.startsWith("mac"));
if (!mac) throw new Error("No mac build in release/. Run npm run package first.");
const exe = join(release, mac, "MyDashie.app", "Contents", "MacOS", "MyDashie");
if (!existsSync(exe)) throw new Error(`Missing ${exe}`);

const userData = mkdtempSync(join(tmpdir(), "dash-packaged-"));
const app = await electron.launch({ executablePath: exe, args: [], env: { ...process.env, DASH_USER_DATA: userData } });
const errors = [];
app.process().stderr?.on("data", (d) => {
  const s = String(d);
  if (/error|exception/i.test(s)) errors.push(s.trim().slice(0, 300));
});
const win = await app.firstWindow();
win.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
win.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
await win.waitForLoadState("domcontentloaded");
await win.waitForTimeout(2500);
const title = await win.title();
const text = (await win.locator("body").innerText()).slice(0, 400).replace(/\s+/g, " ");
const shot = join(root, "assets/generated/packaged-first-run.png");
await win.screenshot({ path: shot });
console.log({ title, text, shot, userData, errors });
await app.close();
console.log(errors.length ? "PACKAGED CHECK: errors above" : "PACKAGED CHECK OK");
