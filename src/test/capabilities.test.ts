import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Tauri capabilities", () => {
  it("allows the main window to open directory dialogs", () => {
    const capability = JSON.parse(
      readFileSync(resolve("src-tauri/capabilities/default.json"), "utf8"),
    ) as { windows: string[]; permissions: string[] };

    expect(capability.windows).toContain("main");
    expect(capability.permissions).toContain("core:default");
    expect(capability.permissions).toContain("dialog:default");
    expect(capability.permissions).toContain("opener:default");
  });
});
