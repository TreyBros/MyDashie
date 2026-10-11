// Copies chart libraries into resources/libs so dashboards work offline via dash-libs/.
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "resources/libs");
mkdirSync(out, { recursive: true });
const libs = {
  "echarts.min.js": "node_modules/echarts/dist/echarts.min.js",
  "chart.umd.js": "node_modules/chart.js/dist/chart.umd.js",
  "d3.min.js": "node_modules/d3/dist/d3.min.js",
};
for (const [name, src] of Object.entries(libs)) {
  copyFileSync(resolve(root, src), resolve(out, name));
  console.log("copied", name);
}
