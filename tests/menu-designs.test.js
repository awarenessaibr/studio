'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'data', 'library');
const catalog = JSON.parse(fs.readFileSync(path.join(LIB, 'menu-catalog.json'), 'utf8'));
const designs = JSON.parse(fs.readFileSync(path.join(LIB, 'menu-designs.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join(LIB, 'index.json'), 'utf8'));
const entries = new Map((index.designs || []).map((entry) => [entry.id, entry]));

test('the confirmed menu catalogue is brand-scoped and complete', () => {
  const brand = catalog.brands['singl-end'];
  assert.ok(brand, 'Singl-end has a menu catalogue');
  assert.equal(brand.source.brandName, 'The Singl-end Café');
  assert.equal(brand.menus.length, 5);
  const items = brand.menus.flatMap((menu) => menu.sections.flatMap((section) => section.items));
  assert.ok(items.length >= 128, `expected at least 128 menu items, found ${items.length}`);
  for (const item of items) {
    assert.match(item.id, /^[a-z0-9-]+$/);
    assert.ok(item.name, `${item.id} has a name`);
  }
});

test('every enabled design has valid menu slots and a current item', () => {
  const itemsByBrand = new Map(Object.entries(catalog.brands).map(([brandId, brand]) => [
    brandId,
    new Set(brand.menus.flatMap((menu) => menu.sections.flatMap((section) => section.items.map((item) => item.id)))),
  ]));
  for (const [id, mapping] of Object.entries(designs.designs)) {
    const items = itemsByBrand.get(mapping.brandId);
    assert.ok(items, `${id} belongs to a catalogued brand`);
    assert.ok(items.has(mapping.currentItemId), `${id} current item exists`);
    if (Array.isArray(mapping.allowedItems)) {
      for (const itemId of mapping.allowedItems) assert.ok(items.has(itemId), `${id} allowed item ${itemId} exists`);
    }
    const entry = entries.get(id);
    assert.ok(entry, `${id} is in the library index`);
    // The studio edits the extracted composition, not the flattened poster.
    const compPath = entry.editableComposition || entry.composition;
    const comp = JSON.parse(fs.readFileSync(path.join(ROOT, compPath), 'utf8'));
    const layerIds = new Set(comp.layers.map((layer) => layer.id));
    assert.ok(mapping.slots.length >= 2, `${id} has product slots`);
    for (const slot of mapping.slots) {
      assert.ok(layerIds.has(slot.layerId), `${id} slot ${slot.layerId} exists`);
      assert.ok(slot.template.includes('{'), `${id} slot ${slot.layerId} has a template`);
      if (slot.pick !== undefined) assert.ok(Number.isInteger(slot.pick), `${id} slot pick is an integer`);
    }
    if (mapping.imageLayerId) assert.ok(layerIds.has(mapping.imageLayerId), `${id} image slot exists`);
  }
});
