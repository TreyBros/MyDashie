import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { McpServerConfig } from "@shared/types";
import type { Paths } from "./paths";

export class McpServerStore {
  private list: McpServerConfig[];
  constructor(private paths: Paths) {
    try {
      this.list = JSON.parse(readFileSync(this.paths.mcpServers, "utf8"));
    } catch {
      this.list = [];
    }
  }
  private save() {
    writeFileSync(this.paths.mcpServers, JSON.stringify(this.list, null, 2));
  }
  all(): McpServerConfig[] {
    return this.list.map((s) => ({ ...s }));
  }
  enabled(): McpServerConfig[] {
    return this.list.filter((s) => s.enabled);
  }
  add(cfg: Omit<McpServerConfig, "id">): McpServerConfig {
    const s = { ...cfg, id: "mcp_" + randomBytes(4).toString("hex") };
    this.list.push(s);
    this.save();
    return s;
  }
  update(id: string, patch: Partial<McpServerConfig>): McpServerConfig | undefined {
    const i = this.list.findIndex((s) => s.id === id);
    if (i < 0) return undefined;
    this.list[i] = { ...this.list[i]!, ...patch, id };
    this.save();
    return this.list[i];
  }
  remove(id: string) {
    this.list = this.list.filter((s) => s.id !== id);
    this.save();
  }
}
