// Turns the generated mascot PNGs into brand assets:
//  - assets/brand/*.png          transparent cutouts (white background removed)
//  - resources/brand/*.png       same, shipped with the app for the UI
//  - resources/brand/trayTemplate.png  monochrome menu-bar icon (22pt @1x/@2x)
//  - resources/icon.png + icon.icns   macOS app icon (mascot on a soft gradient squircle)
import sharp from "sharp";
import { mkdirSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { execSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const raw = resolve(root, "assets/generated/raw");
const brand = resolve(root, "assets/brand");
const shipped = resolve(root, "resources/brand");
mkdirSync(brand, { recursive: true });
mkdirSync(shipped, { recursive: true });

/**
 * White background -> alpha, done properly for dark mode:
 *  1. Flood-fill from the image border through near-white pixels. Only that connected region is background,
 *     so eye whites and highlights inside the character stay fully opaque.
 *  2. Pixels in the background region get alpha from their distance to white (soft anti-aliased edge),
 *     and are un-mixed from white so edges don't glow on dark surfaces.
 */
async function cutout(file, size = 1024, globalWhite = false) {
  const { data, info } = await sharp(file).resize(size, size, { fit: "contain", background: "#ffffff" }).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, px = data;
  const dist = (i) => 255 - Math.min(px[i], px[i + 1], px[i + 2]); // 0 = white
  const LIMIT = 46; // distance-from-white that maps to fully opaque at the edge
  const CORE = 14; // flood only through pixels this close to white, so pale highlights never leak
  const bg = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) { stack.push(x, (H - 1) * W + x); }
  for (let y = 0; y < H; y++) { stack.push(y * W, y * W + W - 1); }
  while (stack.length) {
    const p = stack.pop();
    if (bg[p]) continue;
    if (dist(p * 4) > CORE) continue;
    bg[p] = 1;
    const x = p % W, y = (p - x) / W;
    if (x > 0) stack.push(p - 1);
    if (x < W - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - W);
    if (y < H - 1) stack.push(p + W);
  }
  // Wordmarks: letter counters (inside D, a, R) are enclosed, so also treat any near-white pixel as background.
  if (globalWhite) for (let p = 0; p < W * H; p++) if (dist(p * 4) <= CORE) bg[p] = 1;
  // Soft edge band: pixels within 3px of background (but not background) get alpha by distance from white.
  const band = new Uint8Array(W * H);
  let frontier = [];
  for (let p = 0; p < W * H; p++) if (bg[p]) frontier.push(p);
  for (let step = 0; step < 3; step++) {
    const next = [];
    for (const p of frontier) {
      const x = p % W;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]) {
        if (q < 0 || q >= W * H || bg[q] || band[q]) continue;
        band[q] = 1;
        next.push(q);
      }
    }
    frontier = next;
  }
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    if (!bg[p] && !band[p]) { px[i + 3] = 255; continue; }
    const d = dist(i);
    const a = d <= 8 ? 0 : Math.min(255, Math.round(((d - 8) / (LIMIT - 8)) * 255));
    if (a > 0 && a < 255) {
      const k = 255 / a;
      px[i] = Math.max(0, Math.min(255, 255 - (255 - px[i]) * k));
      px[i + 1] = Math.max(0, Math.min(255, 255 - (255 - px[i + 1]) * k));
      px[i + 2] = Math.max(0, Math.min(255, 255 - (255 - px[i + 2]) * k));
    }
    px[i + 3] = a;
  }
  return sharp(px, { raw: { width: W, height: H, channels: 4 } }).png();
}

async function trimmed(file, size) {
  const buf = await (await cutout(file, 1024)).toBuffer();
  return sharp(buf).trim({ threshold: 1 }).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
}

const poses = readdirSync(raw).filter((f) => f.startsWith("dashy-") || f.startsWith("scene-") || f.startsWith("hero-") || f.startsWith("walk-") || f.startsWith("prop-") || f.startsWith("icon-") || f.startsWith("topic-") || f === "mascot-blob.png");
for (const f of poses) {
  const name = f === "mascot-blob.png" ? "dashy.png" : f;
  const out = await trimmed(resolve(raw, f), f.startsWith("icon-") || f.startsWith("topic-") ? 256 : 768);
  writeFileSync(resolve(brand, name), out);
  writeFileSync(resolve(shipped, name), out);
  console.log("cutout", name);
}

// ---- app icon: just Dashie, filling the canvas (small margin so the macOS dock shadow isn't clipped) ----
const ICON = 1024;
const mascot = await trimmed(resolve(raw, "mascot-blob.png"), 940);
const icon = await sharp({ create: { width: ICON, height: ICON, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: mascot, top: 42, left: 42 }])
  .png()
  .toBuffer();
writeFileSync(resolve(root, "resources/icon.png"), icon);
console.log("icon.png");

// .icns via iconutil (macOS only)
if (process.platform === "darwin") {
  const set = resolve(root, "resources/icon.iconset");
  mkdirSync(set, { recursive: true });
  for (const [n, s] of [["16x16", 16], ["16x16@2x", 32], ["32x32", 32], ["32x32@2x", 64], ["128x128", 128], ["128x128@2x", 256], ["256x256", 256], ["256x256@2x", 512], ["512x512", 512], ["512x512@2x", 1024]]) {
    writeFileSync(resolve(set, `icon_${n}.png`), await sharp(icon).resize(s, s).png().toBuffer());
  }
  execSync(`iconutil -c icns "${set}" -o "${resolve(root, "resources/icon.icns")}"`);
  console.log("icon.icns");
}

// ---- tray template icon: a monochrome silhouette of the mascot head ----
const traySrc = existsSync(resolve(raw, "icon-tray.png")) ? resolve(raw, "icon-tray.png") : resolve(raw, "mascot-blob.png");
for (const [suffix, size] of [["", 22], ["@2x", 44]]) {
  const m = await sharp(await trimmed(traySrc, size * 4)).resize(size, size).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const px = m.data;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; // black, alpha from mascot
  }
  writeFileSync(resolve(shipped, `trayTemplate${suffix}.png`), await sharp(px, { raw: { width: m.info.width, height: m.info.height, channels: 4 } }).png().toBuffer());
}
console.log("trayTemplate.png");

// Windows ico (optional, needs png2ico-ish; electron-builder can convert from png)
if (!existsSync(resolve(root, "resources/icon.ico"))) {
  writeFileSync(resolve(root, "resources/icon-256.png"), await sharp(icon).resize(256, 256).png().toBuffer());
}

// ---- wordmark: generated "MyDashie" logotype, trimmed, wide ----
if (existsSync(resolve(raw, "wordmark-mydashie-a.png"))) {
  const meta = await sharp(resolve(raw, "wordmark-mydashie-a.png")).metadata();
  const cut = await (await cutout(resolve(raw, "wordmark-mydashie-a.png"), Math.max(meta.width, meta.height), true)).toBuffer();
  const trimmedWm = await sharp(cut).trim({ threshold: 1 }).png().toBuffer();
  const out = await sharp(trimmedWm).resize({ height: 160 }).png().toBuffer();
  writeFileSync(resolve(shipped, "wordmark.png"), out);
  writeFileSync(resolve(brand, "wordmark.png"), out);
  console.log("wordmark.png");
}

// ---- welcome-tour art: wide transparent cutouts ----
/**
 * Removes a soft, low-saturation background of any shade (white, grey vignette, faint gradient).
 * Flood-fills from the border through pixels that are (a) low-chroma and (b) close to their neighbor,
 * so smooth background gradients are followed while pastel objects (which have chroma) stop the fill.
 */
async function cutoutSoftBg(file, maxSide) {
  const { data, info } = await sharp(file).resize({ width: maxSide, height: maxSide, fit: "inside" }).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, px = data;
  const chroma = (i) => Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]);
  const light = (i) => (px[i] + px[i + 1] + px[i + 2]) / 3;
  const near = (i, j) => Math.abs(px[i] - px[j]) + Math.abs(px[i + 1] - px[j + 1]) + Math.abs(px[i + 2] - px[j + 2]) <= 18;
  const bg = new Uint8Array(W * H);
  const stack = [];
  const seed = (p) => { const i = p * 4; if (chroma(i) <= 16 && light(i) >= 170) stack.push([p, p]); };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (stack.length) {
    const [p, from] = stack.pop();
    if (bg[p]) continue;
    const i = p * 4;
    if (chroma(i) > 18 || light(i) < 118 || !near(i, from * 4)) continue;
    bg[p] = 1;
    const x = p % W;
    if (x > 0) stack.push([p - 1, p]);
    if (x < W - 1) stack.push([p + 1, p]);
    if (p >= W) stack.push([p - W, p]);
    if (p < W * (H - 1)) stack.push([p + W, p]);
  }
  // Eat grey fringe: grow the background into pale, low-chroma pixels touching it (3 passes).
  for (let pass = 0; pass < 3; pass++) {
    const grow = [];
    for (let p = 0; p < W * H; p++) {
      if (bg[p]) continue;
      const i = p * 4;
      if (chroma(i) > 26 || light(i) < 120) continue;
      const x = p % W;
      if ((x > 0 && bg[p - 1]) || (x < W - 1 && bg[p + 1]) || (p >= W && bg[p - W]) || (p < W * (H - 1) && bg[p + W])) grow.push(p);
    }
    for (const p of grow) bg[p] = 1;
  }
  // 2px feather at the boundary
  const alpha = new Uint8Array(W * H).fill(255);
  for (let p = 0; p < W * H; p++) if (bg[p]) alpha[p] = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let p = 0; p < W * H; p++) {
      if (!bg[p] && alpha[p] === 255) {
        const x = p % W;
        const n = [x > 0 ? p - 1 : p, x < W - 1 ? p + 1 : p, p >= W ? p - W : p, p < W * (H - 1) ? p + W : p];
        if (n.some((q) => alpha[q] === 0 || (pass === 1 && alpha[q] < 255))) alpha[p] = pass === 0 ? 120 : 200;
      }
    }
  }
  for (let p = 0; p < W * H; p++) px[p * 4 + 3] = alpha[p];
  return sharp(px, { raw: { width: W, height: H, channels: 4 } }).png();
}

for (const f of readdirSync(raw).filter((x) => x.startsWith("about-"))) {
  const cut = await (await cutoutSoftBg(resolve(raw, f), 1600)).toBuffer();
  const out = await sharp(cut).trim({ threshold: 1 }).resize({ width: 1400, height: 1000, fit: "inside" }).png().toBuffer();
  writeFileSync(resolve(shipped, f), out);
  console.log("about", f);
}
