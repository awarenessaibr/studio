'use strict';
/**
 * social-store.js — read-only index of scraped business social profiles.
 *
 * Sources, in priority order:
 *   data/_scraped/<group>/_social/<slug>/business.profile.json
 *   data/_crawler/runs/<run>/output/_social/<slug>/business.profile.json
 *   data/_crawler/runs/<run>/output/<kit>/<brand>/social/business.profile.json
 *   data/brand-packs/<pack>/files/<brand>/social/business.profile.json
 *
 * The index stores ids, never request paths. Nothing is written.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Intel = require('./social-intel.js');

const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data');
const MAX_DATASETS = 120;
const TTL_MS = 4000;

let cache = { at: 0, datasets: new Map(), sources: [] };

function readDir(dir) {
    try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}
function readJson(file, fallback = null) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function isFile(file) {
    try { return fs.statSync(file).isFile(); } catch { return false; }
}
function idFor(file) {
    return `soc_${crypto.createHash('sha1').update(path.relative(DATA, file)).digest('hex').slice(0, 12)}`;
}
function kindFor(file) {
    const rel = path.relative(DATA, file).replaceAll(path.sep, '/');
    if (rel.startsWith('brand-packs/')) return 'pack';
    if (rel.startsWith('_crawler/')) return 'run';
    return 'scraped';
}

function candidates() {
    const found = [];
    const add = (file) => { if (isFile(file)) found.push(file); };

    // Curated scraped datasets.
    for (const group of readDir(path.join(DATA, '_scraped'))) {
        if (!group.isDirectory()) continue;
        const socialRoot = path.join(DATA, '_scraped', group.name, '_social');
        for (const slug of readDir(socialRoot)) {
            if (!slug.isDirectory()) continue;
            add(path.join(socialRoot, slug.name, 'business.profile.json'));
        }
    }

    // A crawler run's social working directory.
    const runs = path.join(DATA, '_crawler', 'runs');
    for (const run of readDir(runs)) {
        if (!run.isDirectory()) continue;
        const output = path.join(runs, run.name, 'output');
        const socialRoot = path.join(output, '_social');
        for (const slug of readDir(socialRoot)) {
            if (!slug.isDirectory()) continue;
            add(path.join(socialRoot, slug.name, 'business.profile.json'));
        }
        // The assembled brand kit copies social deliverables beside the brand.
        for (const kit of readDir(output)) {
            if (!kit.isDirectory()) continue;
            for (const brand of readDir(path.join(output, kit.name))) {
                if (!brand.isDirectory()) continue;
                add(path.join(output, kit.name, brand.name, 'social', 'business.profile.json'));
            }
        }
        // A raw host root may also carry a social copy.
        for (const host of readDir(output)) {
            if (!host.isDirectory() || !host.name.endsWith('_root')) continue;
            add(path.join(output, host.name, 'social', 'business.profile.json'));
        }
    }

    // A brand pack may include the social folder even though the pack importer
    // deliberately ignores it when building tokens.
    const packs = path.join(DATA, 'brand-packs');
    for (const pack of readDir(packs)) {
        if (!pack.isDirectory()) continue;
        const files = path.join(packs, pack.name, 'files');
        for (const brand of readDir(files)) {
            if (!brand.isDirectory()) continue;
            add(path.join(files, brand.name, 'social', 'business.profile.json'));
        }
    }
    return [...new Set(found)].slice(0, MAX_DATASETS);
}

function loadDataset(file) {
    const profile = readJson(file);
    if (!profile || typeof profile !== 'object') return null;
    if (!profile.business || (!profile.social && !profile.reputation)) return null;
    const dir = path.dirname(file);
    const tokens = readJson(path.join(dir, 'social.tokens.json'), {});
    const dataset = Intel.normaliseProfile(profile, {
        id: idFor(file),
        kind: kindFor(file),
        file: path.relative(ROOT, file),
        tokens,
    });
    dataset.source = {
        kind: dataset.kind,
        file: dataset.file,
        modifiedAt: new Date(fs.statSync(file).mtimeMs).toISOString(),
    };
    return dataset;
}

function richness(dataset) {
    const collected = dataset.reputation.collectedReviews || 0;
    const reviews = dataset.reputation.totalReviews || 0;
    const followers = dataset.totals.followers || 0;
    const channels = dataset.channels.filter((channel) => channel.present).length;
    const workingCopy = /\/output\/_social\//.test(dataset.source.file.replaceAll(path.sep, '/')) ? 4 : 0;
    return collected * 8 + Math.min(40, reviews / 100) + Math.min(30, followers / 1000) + channels * 4 + workingCopy;
}

function datasetKey(dataset) {
    const clean = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    return `${clean(dataset.group)}|${clean(dataset.business.slug || dataset.business.name)}`;
}

function refresh({ force = false } = {}) {
    const now = Date.now();
    if (!force && now - cache.at < TTL_MS) return cache;
    const datasets = new Map();
    const sources = [];
    const byBusiness = new Map();
    for (const file of candidates()) {
        try {
            const dataset = loadDataset(file);
            if (!dataset) continue;
            const key = datasetKey(dataset);
            const existing = byBusiness.get(key);
            if (existing) {
                if (richness(dataset) <= richness(existing)) continue;
                datasets.delete(existing.id);
                const sourceIndex = sources.findIndex((source) => source.id === existing.id);
                if (sourceIndex >= 0) sources.splice(sourceIndex, 1);
            }
            byBusiness.set(key, dataset);
            datasets.set(dataset.id, dataset);
            sources.push({
                id: dataset.id,
                label: dataset.business.name,
                business: dataset.business,
                group: dataset.group,
                kind: dataset.kind,
                rating: dataset.reputation.rating,
                followers: dataset.totals.followers,
                reviews: dataset.reputation.totalReviews,
                channels: dataset.channels.filter((channel) => channel.present).length,
                generatedAt: dataset.generatedAt,
                modifiedAt: dataset.source.modifiedAt,
            });
        } catch { /* a malformed scrape must not break the index */ }
    }
    sources.sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
    cache = { at: now, datasets, sources };
    return cache;
}

function listSources() {
    return refresh().sources;
}

function list() {
    return listSources();
}

function get(id) {
    const wanted = String(id || '');
    if (!/^soc_[a-f0-9]{12}$/.test(wanted)) return null;
    refresh();
    return cache.datasets.get(wanted) || null;
}

function findByBrand({ brandId = '', name = '' } = {}) {
    refresh();
    let best = null;
    let bestScore = -1;
    for (const dataset of cache.datasets.values()) {
        const score = Intel.matchBrand({ id: brandId, name }, dataset);
        if (score > bestScore || (score === bestScore && String(dataset.source.modifiedAt) > String(best?.source.modifiedAt))) {
            best = dataset;
            bestScore = score;
        }
    }
    return bestScore >= 70 ? best : null;
}

function health() {
    const sources = listSources();
    return {
        datasets: sources.length,
        businesses: sources.length,
        groups: [...new Set(sources.map((source) => source.group).filter(Boolean))].length,
        withRating: sources.filter((source) => source.rating !== null).length,
        withChannels: sources.filter((source) => source.channels > 0).length,
        latestAt: sources[0]?.modifiedAt || null,
    };
}

module.exports = {
    listSources,
    list,
    get,
    findByBrand,
    health,
    refresh,
};
