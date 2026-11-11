#!/usr/bin/env node
'use strict';
/**
 * build-canvas-library.js — install captured canvas reels into the library.
 *
 * The generic build-library.py rebuilds every project from scratch, which
 * would drop the hand-added animations and source attachments of the existing
 * catalogue. This script builds only the new canvas projects in a temporary
 * library, then merges their designs, animations, assets and brand membership
 * into data/library without touching the rest.
 *
 * Usage
 *   node scripts/build-canvas-library.js scripts/source-manifests/butterfly-canvas-reels.json
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const manifestFile = process.argv[2];
if (!manifestFile) {
    console.error('Usage: node scripts/build-canvas-library.js <manifest.json>');
    process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(path.resolve(ROOT, manifestFile), 'utf8'));
const library = path.join(ROOT, 'data', 'library');
const projects = path.join(ROOT, 'data', 'projects');
const metadataFile = path.join(library, 'sources', manifest.metadata || 'canvas-reels.json');
if (!fs.existsSync(metadataFile)) {
    console.error('Run scripts/capture-canvas-reels.js first.');
    process.exit(1);
}
const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
const builder = path.join(ROOT, '_dev', 'agent-first-canvas-library-expansion', 'claude-interaction-downloads', '02-files', 'build-library.py');

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return fallback; }
}

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function mergeUnique(list, values) {
    const out = Array.isArray(list) ? [...list] : [];
    values.forEach((value) => { if (value && !out.includes(value)) out.push(value); });
    return out;
}

function facetsOf(designs) {
    const facets = { kinds: {}, aspects: {}, status: {}, brands: {} };
    designs.forEach((design) => {
        facets.kinds[design.kind] = (facets.kinds[design.kind] || 0) + 1;
        facets.aspects[design.aspect] = (facets.aspects[design.aspect] || 0) + 1;
        facets.status[design.status] = (facets.status[design.status] || 0) + 1;
        facets.brands[design.brandId] = (facets.brands[design.brandId] || 0) + 1;
    });
    return facets;
}

const designs = metadata.designs.filter((design) => fs.existsSync(path.join(projects, design.id, 'compositions', `${design.id}.composition.json`)));
if (!designs.length) {
    console.error('The metadata has no captured projects on disk.');
    process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-library-'));
const tmpProjects = path.join(tmp, 'projects');
const tmpLibrary = path.join(tmp, 'library');
fs.mkdirSync(tmpProjects, { recursive: true });
designs.forEach((design) => {
    fs.symlinkSync(path.join(projects, design.id), path.join(tmpProjects, design.id), 'dir');
});

console.log(`building ${designs.length} canvas design(s) in ${tmpLibrary}`);
cp.execFileSync('python3', [builder, 'build', '--projects', tmpProjects, '--library', tmpLibrary], { stdio: 'inherit' });

const tempIndex = readJson(path.join(tmpLibrary, 'index.json'), { designs: [] });
const tempAssets = readJson(path.join(tmpLibrary, 'assets.json'), { assets: [] });
const tempBusiness = readJson(path.join(tmpLibrary, 'business.json'), { brands: [] });
const byId = new Map(designs.map((design) => [design.id, design]));

// 1. Design detail + original animation, with the source tags kept.
const installed = [];
for (const entry of tempIndex.designs || []) {
    const meta = byId.get(entry.id);
    if (!meta) continue;
    const detailFile = path.join(tmpLibrary, 'designs', `${entry.id}.json`);
    const detail = readJson(detailFile, null);
    if (!detail) continue;
    const tags = mergeUnique(detail.tags, [...(meta.tags || []), 'canvas', meta.mode === 'sim' ? 'animation' : 'reel']);
    detail.tags = tags;
    detail.source = {
        kind: 'canvas-reel',
        file: meta.source,
        collection: meta.sourceCollection,
        reelIndex: meta.reelIndex,
        reelTitle: meta.reelTitle,
        posterTime: meta.posterTime,
        fps: meta.fps,
    };
    writeJson(path.join(library, 'designs', `${entry.id}.json`), detail);

    const animFile = path.join(tmpLibrary, 'animations', entry.id, 'original.animation.json');
    if (fs.existsSync(animFile)) {
        writeJson(path.join(library, 'animations', entry.id, 'original.animation.json'), readJson(animFile, {}));
    }
    installed.push({ ...entry, tags });
    console.log(`✓ ${entry.id} — ${entry.status}, ${entry.layers} layer(s), ${entry.duration} ms`);
}

// 2. Assets: add the poster for each new design, keep existing uses.
const assetsFile = path.join(library, 'assets.json');
const assets = readJson(assetsFile, { schema: 'agent-studio/library/1', assets: [] });
const assetById = new Map((assets.assets || []).map((asset) => [asset.id, asset]));
(tempAssets.assets || []).forEach((asset) => {
    if (!asset || !asset.id) return;
    if (!assetById.has(asset.id)) {
        assets.assets.push(asset);
        assetById.set(asset.id, asset);
    }
});

// 3. Business: keep the existing brand record, add the new designs.
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

// 4. Index: replace/add the new entries and recompute the aggregates.
const indexFile = path.join(library, 'index.json');
const index = readJson(indexFile, { schema: 'agent-studio/library/1', designs: [] });
const designById = new Map((index.designs || []).map((design) => [design.id, design]));
installed.forEach((entry) => designById.set(entry.id, entry));
index.designs = [...designById.values()];
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

// 5. Attach the recordings (and set the thumbnail to the source poster).
cp.execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'attach-source-videos.js')], { stdio: 'inherit' });
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`installed ${installed.length} canvas design(s); library now ${index.designs.length} designs`);
