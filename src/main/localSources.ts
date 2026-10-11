import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { LocalSource } from "./context";

/** Things on this Mac the agent can read directly, or apps it should reach through connected apps. */
export function discoverLocalSources(): LocalSource[] {
  const home = homedir();
  const appSupport = join(home, "Library", "Application Support");
  const granola = existsSync(join(appSupport, "Granola"));
  const notesDb = join(home, "Library", "Group Containers", "group.com.apple.notes", "NoteStore.sqlite");
  const list: LocalSource[] = [
    {
      id: "files",
      name: "Files on this Mac",
      kind: "file",
      hint: "CSV, Excel, JSON, Parquet and SQLite files anywhere in your home folder. Just mention the path.",
      available: true,
    },
    {
      id: "granola",
      name: "Granola",
      kind: "app",
      path: join(appSupport, "Granola"),
      hint: granola
        ? "Granola keeps its notes encrypted on this Mac. Connect Granola under Connected apps and Dashie can read your meetings and notes."
        : "Not installed.",
      available: granola,
    },
    {
      id: "apple-notes",
      name: "Apple Notes",
      kind: "app",
      path: notesDb,
      hint: existsSync(notesDb) ? "Readable as a SQLite file (note bodies are compressed; titles and dates work)." : "Not found.",
      available: existsSync(notesDb),
    },
  ];
  return list;
}
