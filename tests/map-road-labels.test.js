import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("overview map progressively reveals road names instead of delaying every label to zoom 15", async () => {
  const source = await fs.readFile(new URL("../src/integrations/maps.js", import.meta.url), "utf8");
  assert.match(source, /isMajorRoadLabel \? 7/);
  assert.match(source, /isMediumRoadLabel \? 11/);
  assert.match(source, /isRoadLabel \? 13/);
  assert.doesNotMatch(source, /kind === "park" \? 11 : 15/);
});
