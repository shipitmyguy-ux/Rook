import test from "node:test";
import assert from "node:assert/strict";
import { createScratchSession } from "../src/core/scratch-session.js";

function memoryStorage() {
  const data = new Map();
  return {
    getItem:key => data.has(key) ? data.get(key) : null,
    setItem:(key,value) => data.set(key,String(value))
  };
}

const properties = [
  { id:"a", type:"Apartment", price:2100, beds:2, label:"Apartment A" },
  { id:"b", type:"Townhome", price:2500, beds:3, label:"Townhome B" },
  { id:"c", type:"House", price:2200, beds:2, label:"House C", note:"playground nearby" }
];

test("scratch commands mutate the current set and undo restores it", () => {
  const session=createScratchSession("conversation-one",{storage:memoryStorage()});
  session.command("under $2300");
  assert.deepEqual(session.apply(properties).map(p=>p.id),["a","c"]);
  session.command("remove apartments");
  assert.deepEqual(session.apply(properties).map(p=>p.id),["c"]);
  session.undo();
  assert.deepEqual(session.apply(properties).map(p=>p.id),["a","c"]);
});

test("pinned scratch properties survive filters", () => {
  const session=createScratchSession("conversation-two",{storage:memoryStorage()});
  session.setFilters({maxPrice:2300});
  session.togglePin("b");
  assert.deepEqual(session.apply(properties).map(p=>p.id),["a","b","c"]);
});

test("scratch sessions remain isolated by workspace", () => {
  const storage=memoryStorage();
  const one=createScratchSession("chat-one",{storage});
  const two=createScratchSession("chat-two",{storage});
  one.command("only houses");
  assert.deepEqual(one.apply(properties).map(p=>p.id),["c"]);
  assert.equal(two.apply(properties).length,3);
});
