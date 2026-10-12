import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { DashboardRepo } from "./repo";

/** Pages with a hand-written title: swap the agent's original name for the user's name. */
const TITLE_SWAP = `(function(){var D=window.DASH;if(!D||!D.userNamed||!D.originalName||D.originalName===D.name)return;function swap(){var els=document.querySelectorAll("title,h1,h2,.dk-title");for(var i=0;i<els.length;i++){var e=els[i];if(e.children.length===0&&e.textContent.trim()===D.originalName)e.textContent=D.name;}}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){swap();setTimeout(swap,400);});else{swap();setTimeout(swap,400);}})();`;

/** JS that defines window.DASH for a dashboard. Served as dash-data.js and inlined on export. */
export function dataScript(repo: DashboardRepo, id: string): string {
  const m = repo.get(id);
  const data = repo.getData(id);
  const payload = {
    name: m?.name ?? "Dashboard",
    // The user renamed it: the page title follows their name rather than the one baked into the HTML.
    userNamed: !!m?.nameLocked,
    originalName: m?.nameLocked ? (m.aiName ?? null) : null,
    fetchedAt: data?.fetchedAt ?? null,
    staleSince: m?.staleSince ?? null,
    data: data?.datasets ?? {},
  };
  // Escape </script> sequences so inlining is safe.
  return `window.DASH = ${JSON.stringify(payload).replace(/<\//g, "<\\/")};${TITLE_SWAP}`;
}

/** Produces a single self-contained HTML file: libs and data inlined. */
export function exportStandalone(repo: DashboardRepo, libsDir: string, id: string): string {
  const html = repo.getHtml(id);
  if (!html) throw new Error("Dashboard has no HTML yet");
  let out = html.replace(/<script\s+src=["']\.?\/?dash-data\.js["']\s*><\/script>/i, () => `<script>${dataScript(repo, id)}</script>`);
  out = out.replace(/<script\s+src=["']\.?\/?dash-libs\/([a-zA-Z0-9_.-]+)["']\s*><\/script>/gi, (_m, file: string) => {
    const p = join(libsDir, file);
    if (!existsSync(p)) return `<script>console.error("missing lib ${file}")</script>`;
    return `<script>${readFileSync(p, "utf8").replace(/<\/script>/gi, "<\\/script>")}</script>`;
  });
  out = out.replace(/<link\s+[^>]*href=["']\.?\/?dash-libs\/([a-zA-Z0-9_.-]+\.css)["'][^>]*>/gi, (_m, file: string) => {
    const p = join(libsDir, file);
    return existsSync(p) ? `<style>${readFileSync(p, "utf8")}</style>` : "";
  });
  if (!/<meta[^>]+charset/i.test(out)) out = out.replace(/<head>/i, '<head><meta charset="utf-8">');
  return out;
}
