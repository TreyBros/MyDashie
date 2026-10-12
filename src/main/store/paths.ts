import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** All on-disk locations. `root` is Electron's userData in the app and a temp dir in tests/smoke. */
export class Paths {
  constructor(public readonly root: string) {
    mkdirSync(this.dashboards, { recursive: true });
    mkdirSync(this.work, { recursive: true });
  }
  get settings() {
    return join(this.root, "settings.json");
  }
  get secrets() {
    return join(this.root, "secrets.bin");
  }
  get mcpServers() {
    return join(this.root, "mcp-servers.json");
  }
  get usage() {
    return join(this.root, "usage.jsonl");
  }
  get cloudQueue() {
    return join(this.root, "cloud-queue.jsonl");
  }
  get dashboards() {
    return join(this.root, "dashboards");
  }
  get work() {
    return join(this.root, "work");
  }
  get duckdb() {
    return join(this.root, "work", "dash.duckdb");
  }
  dashboard(id: string) {
    return join(this.dashboards, id);
  }
}
