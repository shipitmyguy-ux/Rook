import test from 'node:test';import assert from 'node:assert/strict';import {availableShowingSlots,availabilityText} from '../src/core/showing-availability.js';
test('personal busy windows and travel buffer block proposed times',()=>{
const slots=availableShowingSlots([{start:'2026-10-02T09:00:00-06:00',end:'2026-10-02T13:00:00-06:00'}],{now:new Date('2026-10-01T17:00:00-06:00'),limit:1});
assert.equal(slots[0].start,'2026-10-02T19:30:00.000Z');assert.match(availabilityText(slots),/Friday, Oct 2/);
});
test('fully blocked calendar never fabricates availability',()=>{
assert.equal(availableShowingSlots([{start:'2026-10-01T00:00:00Z',end:'2026-10-10T00:00:00Z'}],{now:new Date('2026-10-01T17:00:00-06:00')}).length,0);
});
test('different days are offered and invalid calendar intervals fail closed',()=>{
const slots=availableShowingSlots([],{now:new Date('2026-10-01T17:00:00-06:00')});assert.equal(slots.length,3);
assert.throws(()=>availableShowingSlots([{start:'bad',end:'bad'}]));
});
