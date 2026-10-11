import { Tray, Menu, nativeImage, app, type BrowserWindow } from "electron";
import { join } from "node:path";
import type { AppContext } from "./context";
import { describeSchedule } from "./scheduler";

export function createTray(ctx: AppContext, getWindow: () => BrowserWindow, brandDir: string) {
  brandDirRef = brandDir;
  const iconPath = join(brandDir, "trayTemplate.png");
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  const tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("MyDashie");

  const rebuild = (): void => {
    const dashboards = ctx.repo.list().filter((d) => d.hasHtml);
    const menu = Menu.buildFromTemplate([
      { label: "Open MyDashie", click: (): void => showWindow(getWindow()) },
      { type: "separator" },
      ...(dashboards.length
        ? dashboards.slice(0, 12).map((d) => ({
            label: d.name,
            icon: topicImage(d.icon),
            sublabel: d.status === "stale" ? "Needs attention" : describeSchedule(d.schedule),
            submenu: [
              { label: "Refresh now", enabled: !ctx.scheduler.isRunning(d.id), click: (): void => { void ctx.scheduler.runNow(d.id, "manual"); } },
              { label: "Open", click: (): void => { showWindow(getWindow()); getWindow().webContents.send("app:navigate", { to: "dashboard", id: d.id }); } },
            ],
          }))
        : [{ label: "No dashboards yet", enabled: false }]),
      { type: "separator" },
      { label: ctx.scheduler.paused ? "Resume schedules" : "Pause schedules", click: (): void => { ctx.scheduler.paused = !ctx.scheduler.paused; rebuild(); } },
      { label: "Quit MyDashie", click: (): void => { (app as typeof app & { isQuitting?: boolean }).isQuitting = true; app.quit(); } },
    ]);
    tray.setContextMenu(menu);
  };
  rebuild();
  ctx.repo.onChange(rebuild);
  tray.on("click", () => tray.popUpContextMenu());
  return tray;
}

function topicImage(topic?: string) {
  const img = nativeImage.createFromPath(join(brandDirRef, `topic-${topic || "general"}.png`));
  return img.isEmpty() ? undefined : img.resize({ width: 18, height: 18 });
}
let brandDirRef = "";

export function showWindow(win: BrowserWindow) {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  app.dock?.show();
}
