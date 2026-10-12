import { describe, it, expect } from "vitest";
import { isReadOnlyTool } from "../src/main/connectors/mcp";

describe("read-only MCP tools", () => {
  it("keeps reads and drops writes", () => {
    for (const n of ["list_issues", "getPost", "search_messages", "get_dataset", "fetch_settings", "query", "list_shared_files", "read_file", "run_report"]) expect(isReadOnlyTool({ name: n }), n).toBe(true);
    for (const n of ["create_issue", "sendEmail", "delete_file", "issues_update", "addComment", "upload", "post_message", "ShareDocument"]) expect(isReadOnlyTool({ name: n }), n).toBe(false);
  });
  it("trusts the server's own annotations first", () => {
    expect(isReadOnlyTool({ name: "create_report_preview", annotations: { readOnlyHint: true } })).toBe(true);
    expect(isReadOnlyTool({ name: "sync", annotations: { readOnlyHint: false } })).toBe(false);
    expect(isReadOnlyTool({ name: "cleanup", annotations: { destructiveHint: true } })).toBe(false);
  });
});
