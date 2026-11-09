#!/usr/bin/env node
/** Build data/library/menu-catalog.json from confirmed brand-pack menus. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const slug = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const packsDir = path.join(ROOT, 'data', 'brand-packs');
const business = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'library', 'business.json'), 'utf8'));
const brands = {};
const aliases = { 'singl-end': /singl[\s-]*end/i };

const packBrands = [];
for (const id of fs.readdirSync(packsDir)) {
  const file = path.join(packsDir, id, 'pack.json');
  if (!fs.existsSync(file)) continue;
  const pack = JSON.parse(fs.readFileSync(file, 'utf8')).pack || JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const brand of pack.brands || []) {
    if (brand.content && Array.isArray(brand.content.menus) && brand.content.menus.length) {
      packBrands.push({ packId: pack.id || id, brand });
    }
  }
}

for (const libraryBrand of business.brands || []) {
  const match = packBrands.find(({ brand }) => aliases[libraryBrand.id]?.test(brand.name || '') || brand.name === libraryBrand.name);
  if (!match) continue;
  const menus = [];
  for (const menu of match.brand.content.menus) {
    const sections = [];
    for (const section of menu.sections || []) {
      const items = [];
      for (const item of section.items || []) {
        if (!item || !item.name) continue;
        const itemId = slug(`${menu.id}-${section.name}-${item.name}`);
        items.push({
          id: itemId,
          name: item.name,
          description: item.description || '',
          price: item.price || '',
          note: item.note || '',
          dietary: Array.isArray(item.dietary) ? item.dietary : [],
          image: item.image || '',
        });
      }
      if (items.length) sections.push({ name: section.name || '', note: section.note || '', items });
    }
    if (sections.length) menus.push({ id: menu.id, name: menu.name || menu.id, sections });
  }
  brands[libraryBrand.id] = {
    id: libraryBrand.id,
    name: libraryBrand.name,
    source: { packId: match.packId, brandId: match.brand.id, brandName: match.brand.name },
    menus,
  };
}
const out = { schema: 'agent-studio/menu-catalog/1', builtAt: new Date().toISOString(), brands };
fs.writeFileSync(path.join(ROOT, 'data', 'library', 'menu-catalog.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${Object.keys(brands).length} brand menu catalogue(s), ${Object.values(brands).reduce((n, b) => n + b.menus.length, 0)} menu(s)`);
