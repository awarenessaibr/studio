#!/usr/bin/env node
'use strict';
/**
 * sync-brand-content.js — copy `files/<brand>/content/<brand>.json` into
 * `pack.json`.
 *
 * The content file is the editable source for a brand's menus, hours and
 * authored copy deck; `pack.json` is what the app reads. Editing one without
 * the other is how a template ends up with stale copy, so this script is the
 * bridge. It is idempotent: unchanged content is skipped, and an absent
 * content folder leaves the brand alone.
 *
 * Usage
 *   node scripts/sync-brand-content.js                  # every pack on disk
 *   node scripts/sync-brand-content.js --pack=<packId>  # one pack
 *   node scripts/sync-brand-content.js --brand=<brandId> # one brand in every pack
 *   node scripts/sync-brand-content.js --dry-run         # report only
 */
const fs = require('node:fs');
const path = require('node:path');
const Brand = require('../src/shared/brand-pack.js');

const ROOT = path.resolve(__dirname, '..');
const PACKS = path.join(ROOT, 'data', 'brand-packs');

function parseArgs(argv) {
    const options = { pack: '', brand: '', dryRun: false };
    argv.forEach((arg) => {
        const [flag, value = ''] = arg.split('=');
        if (flag === '--pack') options.pack = value;
        else if (flag === '--brand') options.brand = value;
        else if (flag === '--dry-run') options.dryRun = true;
        else if (flag === '--help' || flag === '-h') {
            console.log('Usage: node scripts/sync-brand-content.js [--pack=id] [--brand=id] [--dry-run]');
            process.exit(0);
        } else {
            console.error(`Unknown option: ${arg}`);
            process.exit(2);
        }
    });
    return options;
}

function contentFile(packDir, brand) {
    // `dir` is the kit folder the crawler wrote (often `01-the-brand`), but an
    // imported pack can store the files under the brand id instead. Try both
    // and take the one that exists rather than silently skipping the brand.
    const names = [brand.id, brand.dir].filter(Boolean);
    for (const name of names) {
        const dir = path.join(packDir, 'files', name, 'content');
        if (!fs.existsSync(dir)) continue;
        const preferred = path.join(dir, `${name}.json`);
        if (fs.existsSync(preferred)) return preferred;
        const first = fs.readdirSync(dir).find((file) => file.endsWith('.json'));
        if (first) return path.join(dir, first);
    }
    return null;
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const packs = fs.existsSync(PACKS)
        ? fs.readdirSync(PACKS, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && (!options.pack || entry.name === options.pack))
            .map((entry) => entry.name)
        : [];
    if (!packs.length) {
        console.error(options.pack ? `Pack “${options.pack}” not found.` : 'No brand packs on disk.');
        process.exit(1);
    }
    let written = 0;
    let skipped = 0;
    packs.forEach((packId) => {
        const packDir = path.join(PACKS, packId);
        const file = path.join(packDir, 'pack.json');
        if (!fs.existsSync(file)) return;
        let raw;
        try {
            raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (error) {
            console.error(`! ${packId}: pack.json is not valid JSON (${error.message})`);
            return;
        }
        const pack = raw.pack || raw;
        let changed = false;
        (pack.brands || []).forEach((brand) => {
            if (options.brand && brand.id !== options.brand) return;
            const source = contentFile(packDir, brand);
            if (!source) return;
            let parsed;
            try {
                parsed = JSON.parse(fs.readFileSync(source, 'utf8'));
            } catch (error) {
                console.error(`! ${packId}/${brand.id}: ${path.relative(ROOT, source)} is not valid JSON`);
                return;
            }
            const normalized = Brand.normalizeContent(parsed);
            if (!normalized) return;
            // The content file also lists the source documents; the brand
            // carries them so the asset library can index the PDFs.
            const documents = Brand.normalizeDocuments(parsed.documents);
            const before = JSON.stringify([brand.content || null, brand.documents || null]);
            const after = JSON.stringify([normalized, documents.length ? documents : null]);
            if (before === after) {
                skipped += 1;
                return;
            }
            brand.content = normalized;
            if (documents.length) brand.documents = documents;
            else delete brand.documents;
            changed = true;
            written += 1;
            console.log(`${options.dryRun ? '·' : '✓'} ${packId}/${brand.id} ← ${path.relative(ROOT, source)}`);
        });
        if (changed && !options.dryRun) {
            const stamp = new Date().toISOString();
            raw.updatedAt = stamp;
            pack.updatedAt = stamp;
            const temp = `${file}.tmp`;
            fs.writeFileSync(temp, `${JSON.stringify(raw, null, 2)}\n`);
            fs.renameSync(temp, file);
        }
    });
    console.log(`${options.dryRun ? 'Would update' : 'Updated'} ${written} brand${written === 1 ? '' : 's'} · ${skipped} already in sync`);
}

main();
