import test from 'node:test';
import assert from 'node:assert/strict';
import {showingRequestMessage,showingRequestPatch,isShowingPending} from '../src/core/showing-request.js';
test('request message includes the saved time windows and timezone',()=>{
const msg=showingRequestMessage({label:'Example home'},'Tuesday after 4 PM','America/Denver');
assert.match(msg,/Tuesday after 4 PM/);assert.match(msg,/America\/Denver/);assert.match(msg,/Example home/);
});
test('no availability produces an honest request rather than invented times',()=>{
assert.match(showingRequestMessage({},''),/Please let me know your available showing times/);
});
test('confirmed submission records a new pending request time and preserves history',()=>{
const p={status:'contacted',contactedAt:'2026-01-01',metadata:{note:'keep'}};
const patch=showingRequestPatch(p,'message','2026-10-01T23:00:00Z');
assert.equal(patch.contactedAt,'2026-10-01T23:00:00Z');
assert.equal(patch.metadata.note,'keep');assert.equal(patch.metadata.showingRequest.message,'message');
assert.ok(isShowingPending({...p,...patch}));
});
test('scheduled tours cannot be overwritten by a request confirmation',()=>{
assert.equal(showingRequestPatch({status:'showing-scheduled'}),null);
assert.equal(showingRequestPatch({showingAt:'2026-10-02'}),null);
assert.equal(isShowingPending({status:'showing-requested',showingAt:'2026-10-02'}),false);
});
