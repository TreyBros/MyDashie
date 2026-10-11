import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { Settings } from "@shared/types";
import { DEFAULT_BUILD_MODEL, DEFAULT_REFRESH_MODEL } from "@shared/models";
import type { Paths } from "./paths";

const DEFAULTS: Settings = {
  buildModel: { model: DEFAULT_BUILD_MODEL, effort: "medium" },
  refreshModel: { model: DEFAULT_REFRESH_MODEL, effort: "low" },
  theme: "system",
  launchAtLogin: false,
  notifications: true,
  installId: "",
  onboarded: false,
  power: "auto",
};

export class SettingsStore {
  private data: Settings;
  constructor(private paths: Paths) {
    this.data = this.load();
    if (!this.data.installId) {
      this.data.installId = "dash_" + randomBytes(8).toString("hex");
      this.save();
    }
  }
  private load(): Settings {
    try {
      return { ...DEFAULTS, ...JSON.parse(readFileSync(this.paths.settings, "utf8")) };
    } catch {
      return { ...DEFAULTS };
    }
  }
  private save() {
    writeFileSync(this.paths.settings, JSON.stringify(this.data, null, 2));
  }
  get(): Settings {
    return { ...this.data };
  }
  patch(p: Partial<Settings>): Settings {
    this.data = { ...this.data, ...p };
    this.save();
    return this.get();
  }
}
