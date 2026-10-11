import { protocol, net } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { join, normalize, extname } from "node:path";
import { pathToFileURL } from "node:url";
import type { DashboardRepo } from "./repo";
import { dataScript } from "./export";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

/** Must run before app.whenReady(). */
export function registerDashScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: "dash", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true } },
  ]);
}

const DASHBOARD_CSP = [
  "default-src 'none'",
  "script-src dash: 'unsafe-inline'",
  "style-src dash: 'unsafe-inline' https://fonts.googleapis.com",
  "img-src dash: data: blob: https:",
  "font-src dash: data: https://fonts.gstatic.com",
  "connect-src 'none'",
  "frame-src 'none'",
].join("; ");

/**
 * dash://dashboards/<id>/index.html     the dashboard page (CSP-locked)
 * dash://dashboards/<id>/dash-data.js   window.DASH payload, generated on the fly
 * dash://dashboards/<id>/dash-libs/x.js chart libraries
 * dash://dashboards/<id>/thumbnail.png  screenshot
 * dash://brand/<file>                   mascot and brand art for the app UI
 */
export function handleDashProtocol(repo: DashboardRepo, libsDir: string, brandDir: string) {
  protocol.handle("dash", async (request) => {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const host = url.hostname;

    if (host === "brand") {
      return serveFile(join(brandDir, normalize(parts.join("/"))), brandDir);
    }
    if (host !== "dashboards" || parts.length < 2) return new Response("Not found", { status: 404 });
    const [id, ...rest] = parts;
    if (!/^[a-z0-9]{6,24}$/.test(id!)) return new Response("Bad id", { status: 400 });
    const file = rest.join("/");

    if (file === "index.html") {
      const html = repo.getHtml(id!);
      if (!html) return new Response(emptyPage(), { headers: { "content-type": MIME[".html"]!, "content-security-policy": DASHBOARD_CSP } });
      return new Response(withLinkHandler(html), { headers: { "content-type": MIME[".html"]!, "content-security-policy": DASHBOARD_CSP, "cache-control": "no-store" } });
    }
    if (file === "dash-data.js") {
      return new Response(dataScript(repo, id!), { headers: { "content-type": MIME[".js"]!, "cache-control": "no-store" } });
    }
    if (rest[0] === "dash-libs" && rest.length === 2) {
      return serveFile(join(libsDir, rest[1]!), libsDir);
    }
    if (file === "thumbnail.png") {
      return serveFile(repo.thumbnailPath(id!), repo.dir(id!));
    }
    return new Response("Not found", { status: 404 });
  });
}

function serveFile(path: string, root: string): Response | Promise<Response> {
  const resolved = normalize(path);
  if (!resolved.startsWith(normalize(root)) || !existsSync(resolved)) return new Response("Not found", { status: 404 });
  const type = MIME[extname(resolved)] ?? "application/octet-stream";
  if (type.startsWith("text/") || type.includes("json")) {
    return new Response(readFileSync(resolved), { headers: { "content-type": type, "cache-control": "no-store" } });
  }
  return net.fetch(pathToFileURL(resolved).toString()).then((r) => new Response(r.body, { headers: { "content-type": type, "cache-control": "no-store" } }));
}

/** Every web link in a dashboard (sources, spreadsheets, OneDrive files, app records) opens in the user's browser. */
const LINK_HANDLER = `<script>document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(!a)return;var h=a.getAttribute("href")||"";if(/^(https?:|mailto:)/i.test(h)){e.preventDefault();window.open(a.href,"_blank","noopener");}},true);</script>`;

/** Select-to-edit: the app turns this on, the user clicks a card, and the app learns which one. */
const SELECT_HANDLER = `<style>.dash-pick-hover{outline:3px solid #7c6cf6!important;outline-offset:3px;border-radius:18px;cursor:pointer}.dash-pick-on *{cursor:pointer!important}</style><script>(function(){var on=false,last=null;
function card(t){if(!t||!t.closest)return null;return t.closest(".dk-card,.dk-kpi,.dk-insight,section[id],.dk-header,.dk-tabs")}
function info(el){var tEl=el.querySelector(".dk-card-title,.dk-kpi-label,.dk-title,h1,h2,h3");var title=(tEl&&tEl.textContent||el.getAttribute("data-title")||el.textContent||"").trim().replace(/\\s+/g," ").slice(0,80);var pg=el.closest(".dk-page");return{type:"dash-selected",id:el.id||"",title:title,kind:el.classList.contains("dk-kpi")?"KPI card":el.classList.contains("dk-header")?"header":el.classList.contains("dk-tabs")?"page tabs":el.classList.contains("dk-insight")?"insight":"card",page:pg?(pg.getAttribute("data-title")||pg.getAttribute("data-page")):""}}
function clear(){if(last){last.classList.remove("dash-pick-hover");last=null}}
window.addEventListener("message",function(e){if(e.data&&e.data.type==="dash-select-mode"){on=!!e.data.on;document.documentElement.classList.toggle("dash-pick-on",on);if(!on)clear()}});
document.addEventListener("mouseover",function(e){if(!on)return;var c=card(e.target);if(c===last)return;clear();if(c){c.classList.add("dash-pick-hover");last=c}},true);
document.addEventListener("click",function(e){if(!on)return;var c=card(e.target);if(!c)return;e.preventDefault();e.stopPropagation();clear();on=false;document.documentElement.classList.remove("dash-pick-on");parent.postMessage(info(c),"*")},true);
document.addEventListener("keydown",function(e){if(on&&e.key==="Escape"){on=false;clear();document.documentElement.classList.remove("dash-pick-on");parent.postMessage({type:"dash-select-cancel"},"*")}});})();</script>`;

export function withLinkHandler(html: string) {
  const inject = LINK_HANDLER + SELECT_HANDLER;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${inject}</body>`) : html + inject;
}

function emptyPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{height:100%;margin:0;font-family:-apple-system,Inter,sans-serif;background:#FAFAF7;color:#6b6b76;display:grid;place-items:center}</style></head><body><div>Nothing here yet</div></body></html>`;
}
