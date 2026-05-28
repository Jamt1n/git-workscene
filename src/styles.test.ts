import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");

function block(selector: string) {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

describe("layout styles", () => {
  it("keeps the inspector as the branch detail scroll container", () => {
    expect(block(".app-shell")).toContain("overflow: hidden");
    expect(block(".inspector-shell")).toContain("overflow: hidden");
    expect(block(".inspector-content")).toContain("overflow: auto");
    expect(block(".inspector-content")).toContain("scrollbar-gutter: stable");
    expect(block(".inspector-content.with-commits")).toContain("flex-basis: 0");
    expect(block(".inspector-content.with-commits")).toContain("overflow: auto");
    expect(block(".commit-panel")).toContain("overflow: visible");
    expect(block(".commit-panel.is-open")).toContain("flex: 0 0 auto");
    expect(block(".commit-list")).toContain("flex: 0 0 auto");
    expect(block(".commit-list")).toContain("overflow: visible");
  });
});
