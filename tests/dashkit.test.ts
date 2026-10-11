import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";

const libs = resolve("resources/libs");
let browser: Browser | null = null;

beforeAll(async () => {
  browser = await chromium.launch({ channel: "chrome" }).catch(() => null);
});
afterAll(async () => {
  await browser?.close();
});

// Renders every Dash Kit component (including multi-series and table views) in real Chrome and
// fails on any page error, so a broken component can't silently push the agent to work around it.
describe("Dash Kit renders", () => {
  it("draws every component without errors", async (t) => {
    if (!browser) return t.skip();
    const rows = [
      { m: "2026-01", region: "East", rev: 120, units: 4, day: "Mon", hour: 9 },
      { m: "2026-02", region: "West", rev: 90, units: 6, day: "Tue", hour: 10 },
      { m: "2026-03", region: "North", rev: 150, units: 3, day: "Wed", hour: 11 },
    ];
    const html = `<!doctype html><html><head><link rel="stylesheet" href="file://${libs}/dashkit.css"></head><body>
<header id="hdr"></header><nav id="tabs"></nav>
<section class="dk-page" data-page="one" data-title="One">
  <div id="i"></div><div id="k"></div><div id="b"></div><div id="b2"></div><div id="bh"></div><div id="l"></div><div id="l2"></div>
</section>
<section class="dk-page" data-page="two" data-title="Two">
  <div id="d"></div><div id="hm"></div><div id="t"></div><div id="li"></div><div id="s"></div><div id="e"></div>
</section>
<footer id="f"></footer>
<script>window.DASH = { name: "Test", fetchedAt: new Date().toISOString(), data: { r: ${JSON.stringify(rows)} } };</script>
<script src="file://${libs}/echarts.min.js"></script>
<script src="file://${libs}/dashkit.js"></script>
<script>
Dash.header("#hdr", { title: "T", eyebrow: "E", subtitle: "S" });
Dash.insight("#i", "Revenue is <strong>up</strong>.");
Dash.kpi("#k", { label: "Rev", value: 360, previous: 300, format: "currency", goodWhen: "up", spark: [1, 2, 3] });
Dash.bar("#b", { title: "Bar", data: "r", x: "region", y: "rev", format: "currency", highlight: "East" });
Dash.bar("#b2", { title: "Stacked", data: "r", x: "m", series: ["rev", "units"], stacked: true });
Dash.bar("#bh", { title: "Horizontal", data: "r", x: "region", y: "rev", horizontal: true, labels: true });
Dash.line("#l", { title: "Line", data: "r", x: "m", y: "rev", format: "currency" });
Dash.line("#l2", { title: "Lines", data: "r", x: "m", series: ["rev", "units"] });
Dash.donut("#d", { title: "Donut", data: "r", label: "region", value: "rev" });
Dash.heatmap("#hm", { title: "Heat", data: "r", x: "day", y: "hour", value: "rev" });
Dash.table("#t", { title: "Table", data: "r", columns: [{ key: "region", label: "Region" }, { key: "rev", label: "Rev", format: "currency", bar: true }] });
Dash.list("#li", { title: "List", data: "r", label: "region", value: "rev", format: "currency" });
Dash.segmented("#s", { options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], value: "a", onChange: function () {} });
Dash.echarts("#e", { xAxis: { type: "category", data: ["a"] }, yAxis: {}, series: [{ type: "bar", data: [1] }] });
Dash.footer("#f", "Source: test");
Dash.pages("#tabs");
</script></body></html>`;
    const file = join(mkdtempSync(join(tmpdir(), "dashkit-test-")), "index.html");
    writeFileSync(file, html);
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`file://${file}`);
    await page.waitForTimeout(600);
    expect(errors).toEqual([]);
    expect(await page.evaluate("Dash.pageIds()")).toEqual(["one", "two"]);
    for (const id of ["one", "two"]) {
      await page.evaluate(`Dash.showPage(${JSON.stringify(id)})`);
      await page.waitForTimeout(300);
      // Flip every chart to its table view and back.
      await page.evaluate(`document.querySelectorAll('.dk-page[data-page="${id}"] .dk-card [aria-pressed]').forEach((b) => b.click())`);
      await page.waitForTimeout(200);
    }
    const charts = await page.evaluate("document.querySelectorAll('canvas, svg').length");
    await page.close();
    expect(errors).toEqual([]);
    expect(charts).toBeGreaterThanOrEqual(8);
  }, 30000);

  it("stages a swapped-in version and reveals only new cards", async (t) => {
    if (!browser) return t.skip();
    const html = `<!doctype html><html><head><link rel="stylesheet" href="file://${libs}/dashkit.css"></head><body>
<header id="hdr"></header><main class="dk-grid"><section id="a" class="span-6"></section><section id="b" class="span-6"></section></main>
<script>window.DASH = { name: "T", fetchedAt: "2026-10-11T13:58:00Z", data: { r: [{ x: "a", n: 1 }, { x: "b", n: 3 }] } };</script>
<script src="file://${libs}/echarts.min.js"></script><script src="file://${libs}/dashkit.js"></script>
<script>Dash.header("#hdr", { title: "T", subtitle: Dash.fmt.asOf() }); Dash.kpi("#a", { label: "N", value: 4 }); Dash.bar("#b", { title: "B", data: "r", x: "x", y: "n" });</script></body></html>`;
    const file = join(mkdtempSync(join(tmpdir(), "dashkit-test-")), "index.html");
    writeFileSync(file, html);
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`file://${file}?staged=1`);
    await page.waitForTimeout(400);
    expect(await page.evaluate("document.documentElement.classList.contains('dk-staged')")).toBe(true);
    expect(await page.evaluate("document.querySelector('.dk-subtitle').textContent")).toMatch(/^as of /);
    // Integer series get whole-number ticks (no 0.5, 1.5 …).
    const ticks = (await page.evaluate("Array.from(document.querySelectorAll('#b text')).map((t) => t.textContent)")) as string[];
    expect(ticks.some((x) => /\.5$/.test(x))).toBe(false);
    await page.evaluate("window.postMessage({ type: 'dash-reveal', prevCards: ['a'], scrollY: 0 }, '*')");
    await page.waitForTimeout(100);
    expect(await page.evaluate("Array.from(document.querySelectorAll('.dk-card.dk-new')).map((n) => n.id)")).toEqual(["b"]);
    await page.close();
    expect(errors).toEqual([]);
  }, 30000);
});
