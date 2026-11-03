'use strict';
/**
 * backfill-tokens.js — restore missing `tokens/<brand>.tokens.json` files.
 *
 * The importer parses a brand's token file into `pack.json` (palette,
 * typography, voice) but, before the fix in `server.js`, only persisted
 * *images* to `files/`. The result is a manifest whose `tokensPath` points at
 * nothing: the palette renders because it lives in `pack.json`, while every
 * consumer that opens the declared path fails.
 *
 * This script rebuilds the token file from what the importer already parsed.
 * It is deliberately faithful-but-recovered: the content is the same data the
 * token file supplied, in the same shape, so a re-read yields identical
 * palette, type scale and voice.
 *
 * Usage
 *   node scripts/backfill-tokens.js              # every pack under data/brand-packs
 *   node scripts/backfill-tokens.js <packId> …   # named packs only
 *   node scripts/backfill-tokens.js --dry-run    # report, write nothing
 *
 * Idempotent: an existing token file is never overwritten. Exits 1 if any
 * declared token path is still missing afterwards.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKS_DIR = path.join(ROOT, 'data', 'brand-packs');

/** Builds the token document the importer would have read. */
function tokensFor(brand) {
    const brandMeta = {
        name: brand.name || '',
        wordmark: brand.wordmark || '',
        tagline: brand.tagline || '',
        url: brand.url || '',
        version: brand.version || '',
        captured: brand.captured || '',
    };
    return {
        brand: Object.fromEntries(Object.entries(brandMeta).filter(([, value]) => value !== '')),
        color: Array.isArray(brand.palette) ? brand.palette : [],
        typography: brand.typography && typeof brand.typography === 'object' ? brand.typography : {},
        voice: brand.voice && typeof brand.voice === 'object' ? brand.voice : {},
    };
}

async function readJson(file) {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const wanted = args.filter((arg) => !arg.startsWith('--'));

    const entries = await fsp.readdir(PACKS_DIR, { withFileTypes: true });
    const packs = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
        .filter((id) => !wanted.length || wanted.includes(id));

    if (wanted.length) {
        const missing = wanted.filter((id) => !packs.includes(id));
        if (missing.length) {
            console.error(`Unknown pack(s): ${missing.join(', ')}`);
            process.exit(2);
        }
    }

    let written = 0;
    let present = 0;
    let failed = 0;

    for (const packId of packs) {
        const packDir = path.join(PACKS_DIR, packId);
        const packFile = path.join(packDir, 'pack.json');
        let pack;
        try {
            pack = (await readJson(packFile)).pack;
        } catch (error) {
            if (wanted.length) console.error(`${packId}: cannot read pack.json (${error.message})`);
            continue;
        }
        const filesDir = path.join(packDir, 'files');
        for (const brand of pack.brands || []) {
            const declared = String(brand.tokensPath || '').trim();
            if (!declared || /combined file/i.test(declared)) continue;
            if (!/\.tokens\.json$/i.test(declared)) {
                console.warn(`${packId}/${brand.id}: tokensPath "${declared}" is not a .tokens.json path — skipped.`);
                continue;
            }
            const target = path.join(filesDir, brand.id, ...declared.split('/').filter(Boolean));
            try {
                await fsp.access(target);
                present += 1;
                continue;
            } catch {
                // Missing: rebuild it below.
            }
            const document = tokensFor(brand);
            const hasContent = document.color.length || Object.keys(document.typography).length || Object.keys(document.voice).length;
            if (!hasContent) {
                console.warn(`${packId}/${brand.id}: no parsed palette/type/voice to rebuild ${declared} from — skipped.`);
                failed += 1;
                continue;
            }
            if (dryRun) {
                console.log(`would write ${path.relative(ROOT, target)} (${document.color.length} colours)`);
                written += 1;
                continue;
            }
            await fsp.mkdir(path.dirname(target), { recursive: true });
            await fsp.writeFile(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
            console.log(`wrote ${path.relative(ROOT, target)} (${document.color.length} colours)`);
            written += 1;
        }
    }

    const verb = dryRun ? 'would write' : 'wrote';
    console.log(`\n${verb} ${written} token file(s); ${present} already present; ${failed} could not be rebuilt.`);
    if (failed && !dryRun) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
