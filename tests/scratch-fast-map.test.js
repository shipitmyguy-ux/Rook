import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("overview map exposes property names as a dedicated label layer", async () => {
  const source = await fs.readFile(new URL("../src/integrations/maps.js", import.meta.url), "utf8");
  assert.match(source, /ROOK_PROPERTY_LABEL_LAYER_ID/);
  assert.match(source, /"text-field": \["get", "label"\]/);
  assert.match(source, /minzoom: 11\.5/);
});

test("scratch maps never enter the legacy serial browser geocoder", async () => {
  const source = await fs.readFile(new URL("../src/integrations/maps.js", import.meta.url), "utf8");
  assert.match(source, /if \(property\?\.metadata\?\.workspaceId\) return false;/);
});

test("scratch workspaces poll shared state every second", async () => {
  const source = await fs.readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /isMainWorkspace \? 30000 : 1000/);
});

test("workspace sync does not coerce null coordinates to zero", async () => {
  const syncSource = await fs.readFile(new URL("../src/integrations/sync.js", import.meta.url), "utf8");
  assert.match(syncSource, /row\.lat !== null/);
  assert.match(syncSource, /row\.lng !== null/);
});
