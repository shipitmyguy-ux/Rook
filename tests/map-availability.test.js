import test from 'node:test';
import assert from 'node:assert/strict';
import { mapListings } from '../src/core/listing.js';
import { mainInventoryCandidates } from '../src/core/workspace-filters.js';
import { createPropertyStore } from '../src/core/store.js';
import { ignorePropertyPatch, restoreIgnoredPatch } from '../src/core/property.js';

test('confirmed unavailable listings leave map and cache candidates even with a saved tour; uncertain checks remain', () => {
  const closed = { id:'closed', listingType:'rent', listingState:'closed', saved:true,
    status:'showing-scheduled', showingAt:'2099-01-01T10:00:00Z',
    metadata:{ listingClosedEvidence:{ confirmed:true } } };
  const uncertain = { ...closed, id:'uncertain', listingState:'unknown' };
  const unconfirmed = { ...closed, id:'unconfirmed', metadata:{ listingClosedEvidence:{ confirmed:false } } };
  assert.deepEqual(mapListings([closed, uncertain, unconfirmed]).map(p=>p.id), ['uncertain','unconfirmed']);
  assert.deepEqual(mainInventoryCandidates([closed, uncertain]).map(p=>p.id), ['uncertain']);
  assert.equal(mapListings([{ ...closed, listingState:'active' }]).length, 1);
});

test('ignoring a Laurel card survives reload and rediscovery while Main stays independent; restore permits it again', () => {
  const values = new Map(), old = globalThis.localStorage;
  globalThis.localStorage = { getItem:key=>values.get(key)||null, setItem:(key,value)=>values.set(key,value) };
  try {
    const home = { id:'home', address:'100 Test St', sourceUrl:'https://rentals.test/home', status:'new', note:'Keep note' };
    const main = createPropertyStore([home]);
    const laurel = createPropertyStore([home], { namespace:'laurel-rentals' });
    laurel.update(home.id, ignorePropertyPatch(laurel.getAll()[0]));
    const reloaded = createPropertyStore([], { namespace:'laurel-rentals' });
    reloaded.upsert({ ...home, id:'new-provider-id', price:2100 });
    assert.equal(reloaded.getAll().length, 1);
    assert.equal(reloaded.getAll()[0].status, 'rejected');
    assert.equal(main.getAll()[0].status, 'new');
    reloaded.update(home.id, restoreIgnoredPatch(reloaded.getAll()[0]));
    reloaded.upsert({ ...home, price:2200 });
    assert.equal(reloaded.getAll()[0].status, 'new');
    assert.equal(reloaded.getAll()[0].price, 2200);
    assert.equal(reloaded.getAll()[0].note, 'Keep note');
  } finally { globalThis.localStorage = old; }
});
