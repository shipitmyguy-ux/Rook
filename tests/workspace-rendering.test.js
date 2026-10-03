import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("scratch workspace bypasses Main discovery filters and inherited POIs", async () => {
  const source = await fs.readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /if \(!isMainWorkspace\) return \[\];/);
  assert.match(source, /Scratch workspaces are render-only ideation canvases/);
  assert.match(source, /if \(!isMainWorkspace\) \{/);
  assert.match(source, /filtered = allProperties\.filter/);
});
