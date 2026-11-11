#!/usr/bin/env node
'use strict';
/**
 * build-project-subset.js — build a named set of projects and merge their
 * designs into data/library without rebuilding the rest of the catalogue.
 *
 * The generic build-library.py rebuilds every project; that would drop the
 * hand-added animations and source attachments of the existing designs.
 * This script builds only the requested projects in a temporary library, then
 * merges designs, animations, assets and brand membership.
 *
 * Usage
 *   node scripts/build-project-subset.js --projects=id-a,id-b [--tags=reel,html-stage]
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const library = path.join(ROOT, 'data', 'library');
const projects = path.join(ROOT, 'data', 'projects');
const builder = path.join(ROOT, '_dev', 'agent-first-canvas-library-expansion', 'claude-interaction-downloads', '02-files', 'build-library.py');

function arg(name) {
    const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : '';
}
const ids = arg('projects').split(',').map((value) => value.trim()).filter(Boolean);
const extraTags = arg('tags').split(',').map((value) => value.trim()).filter(Boolean);
const prune = process.argv.includes('--prune');
if (!ids.length) {
    console.error('Usage: node scripts/build-project-subset.js --projects=id-a,id-b [--tags=reel,html-stage]');
    process.exit(2);
}

const readJson = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return fallback; }
};
const writeJson = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const mergeUnique = (list, values) => {
    const out = Array.isArray(list) ? [...list] : [];
    values.forEach((value) => { if (value && !out.includes(value)) out.push(value); });
    return out;
};
const facetsOf = (designs) => {
    const facets = { kinds: {}, aspects: {}, status: {}, brands: {} };
    designs.forEach((design) => {
        facets.kinds[design.kind] = (facets.kinds[design.kind] || 0) + 1;
        facets.aspects[design.aspect] = (facets.aspects[design.aspect] || 0) + 1;
        facets.status[design.status] = (facets.status[design.status] || 0) + 1;
        facets.brands[design.brandId] = (facets.brands[design.brandId] || 0) + 1;
    });
    return facets;
};

for (const id of ids) {
    if (!fs.existsSync(path.join(projects, id, 'compositions', `${id}.composition.json`))) {
        console.error(`missing project or composition: ${id}`);
        process.exit(1);
    }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'project-subset-'));
const tmpProjects = path.join(tmp, 'projects');
const tmpLibrary = path.join(tmp, 'library');
fs.mkdirSync(tmpProjects, { recursive: true });
ids.forEach((id) => fs.symlinkSync(path.join(projects, id), path.join(tmpProjects, id), 'dir'));
cp.execFileSync('python3', [builder, 'build', '--projects', tmpProjects, '--library', tmpLibrary], { stdio: 'inherit' });

const tempIndex = readJson(path.join(tmpLibrary, 'index.json'), { designs: [] });
const tempAssets = readJson(path.join(tmpLibrary, 'assets.json'), { assets: [] });
const tempBusiness = readJson(path.join(tmpLibrary, 'business.json'), { brands: [] });
const installed = [];
for (const entry of tempIndex.designs || []) {
    const detailFile = path.join(tmpLibrary, 'designs', `${entry.id}.json`);
    const detail = readJson(detailFile, null);
    if (!detail) continue;
    detail.tags = mergeUnique(detail.tags, extraTags);
    writeJson(path.join(library, 'designs', `${entry.id}.json`), detail);
    const animFile = path.join(tmpLibrary, 'animations', entry.id, 'original.animation.json');
    if (fs.existsSync(animFile)) {
        writeJson(path.join(library, 'animations', entry.id, 'original.animation.json'), readJson(animFile, {}));
    }
    installed.push({ ...entry, tags: detail.tags });
    console.log(`✓ ${entry.id} — ${entry.status}, ${entry.layers} layer(s), ${entry.duration} ms`);
}

const assetsFile = path.join(library, 'assets.json');
const assets = readJson(assetsFile, { schema: 'agent-studio/library/1', assets: [] });
const assetById = new Map((assets.assets || []).map((asset) => [asset.id, asset]));
(tempAssets.assets || []).forEach((asset) => {
    if (asset && asset.id && !assetById.has(asset.id)) {
        assets.assets.push(asset);
        assetById.set(asset.id, asset);
    }
});
if (prune) {
    // Drop assets that belonged to the replaced extraction and are no longer
    // referenced by any installed layer.
    const referenced = new Set();
    installed.forEach((entry) => {
        const detail = readJson(path.join(library, 'designs', `${entry.id}.json`), { layers: [] });
        (detail.layers || []).forEach((layer) => { if (layer.url) referenced.add(layer.url); });
    });
    const before = assets.assets.length;
    assets.assets = assets.assets.filter((asset) => {
        const owned = ids.some((id) => String(asset.url || '').includes(`/data/projects/${id}/`));
        return !owned || referenced.has(asset.url);
    });
    console.log(`pruned ${before - assets.assets.length} stale asset(s) for the rebuilt project(s)`);
}

const businessFile = path.join(library, 'business.json');
const business = readJson(businessFile, { schema: 'agent-studio/library/1', brands: [] });
for (const brand of tempBusiness.brands || []) {
    const existing = (business.brands || []).find((item) => item.id === brand.id);
    if (existing) {
        existing.designs = mergeUnique(existing.designs, brand.designs || []);
        existing.designs = mergeUnique(existing.designs, installed.filter((design) => design.brandId === brand.id).map((design) => design.id));
    } else {
        business.brands.push(brand);
    }
}

const indexFile = path.join(library, 'index.json');
const index = readJson(indexFile, { schema: 'agent-studio/library/1', designs: [] });
const byId = new Map((index.designs || []).map((design) => [design.id, design]));
installed.forEach((entry) => byId.set(entry.id, entry));
index.designs = [...byId.values()];
for (const design of index.designs) {
    const editable = path.join(ROOT, 'data', 'projects', design.id, 'compositions', `${design.id}.editable.json`);
    if (fs.existsSync(editable)) {
        design.editableComposition = `/data/projects/${design.id}/compositions/${design.id}.editable.json`;
    }
}
index.generatedAt = new Date().toISOString();
index.counts = {
    ...(index.counts || {}),
    designs: index.designs.length,
    ready: index.designs.filter((design) => design.status === 'ready').length,
    brands: new Set(index.designs.map((design) => design.brandId)).size,
    assets: (assets.assets || []).length,
    clips: readJson(path.join(library, 'clips.json'), { clips: [] }).clips.length,
};
index.facets = facetsOf(index.designs);
writeJson(assetsFile, assets);
writeJson(businessFile, business);
writeJson(indexFile, index);
cp.execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'attach-source-videos.js')], { stdio: 'inherit' });
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`installed ${installed.length} project(s); library now ${index.designs.length} designs`);
