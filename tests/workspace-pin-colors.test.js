import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("scratch map source categories drive persistent pin colors", async () => {
  const source = await fs.readFile(new URL("../src/integrations/maps.js", import.meta.url), "utf8");
  assert.match(source, /workspaceSource/);
  assert.match(source, /web-search/);
  assert.match(source, /rook-main/);
  assert.match(source, /reference/);
  assert.match(source, /#4ba8ff/);
  assert.match(source, /#ffc429/);
  assert.match(source, /#58eadc/);
  assert.match(source, /#9664ff/);
});
