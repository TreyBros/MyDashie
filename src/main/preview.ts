import { BrowserWindow, nativeImage } from "electron";
import type { PreviewRenderer } from "./agent/types";
import { QA_SCRIPT, type QaReport } from "./agent/qa";

/** Renders a dashboard offscreen at 1280x800 and returns a downscaled PNG plus console errors. */
export class ElectronPreview implements PreviewRenderer {
  async render(dashboardId: string) {
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    const errors: string[] = [];
    win.webContents.on("console-message", (ev) => {
      const level = (ev as unknown as { level: string | number }).level;
      const message = (ev as unknown as { message: string }).message;
      if (level === "error" || level === 3) errors.push(message);
    });
    win.webContents.on("render-process-gone", (_e, d) => errors.push(`Renderer crashed: ${d.reason}`));
    try {
      await win.loadURL(`dash://dashboards/${dashboardId}/index.html`);
      await new Promise((r) => setTimeout(r, 1800)); // let charts animate in
      const title = win.webContents.getTitle();
      const shoot = async () => {
        win.setContentSize(1280, 800);
        await new Promise((r) => setTimeout(r, 250));
        const qa = (await win.webContents.executeJavaScript(QA_SCRIPT).catch(() => undefined)) as QaReport | undefined;
        // Capture the whole page (capped) so the agent sees everything, not just the first screen.
        const fullH = Math.min(2600, Math.max(800, qa?.stats.pageHeight ?? 800));
        if (fullH > 800) {
          win.setContentSize(1280, fullH);
          await new Promise((r) => setTimeout(r, 500));
        }
        const image = await win.webContents.capturePage();
        return { png: nativeImage.createFromBuffer(image.toPNG()).resize({ width: 960 }).toPNG(), qa };
      };
      const ids = ((await win.webContents.executeJavaScript("window.Dash && Dash.pageIds ? Dash.pageIds() : []").catch(() => [])) as string[]) ?? [];
      if (ids.length < 2) {
        const one = await shoot();
        return { png: one.png, errors, title, qa: one.qa };
      }
      const pages = [];
      for (const id of ids.slice(0, 6)) {
        await win.webContents.executeJavaScript(`Dash.showPage(${JSON.stringify(id)}); 1`);
        await new Promise((r) => setTimeout(r, 700));
        const pageTitle = (await win.webContents.executeJavaScript(`Dash.pageTitle(${JSON.stringify(id)})`).catch(() => id)) as string;
        pages.push({ id, title: pageTitle, ...(await shoot()) });
      }
      return { png: pages[0]!.png, errors, title, qa: pages[0]!.qa, pages };
    } finally {
      win.destroy();
    }
  }
}
