'use strict';
/**
 * consolidate-platforms.js — separate "we looked" from "we found".
 *
 * Every connector used to write `social/platforms/<source>.json`, including the
 * ones that discovered no profile URL. The result is a folder full of
 * `{ ok: false, url: null, warnings: ["no … URL discovered"] }` files that read
 * like platforms in a file listing, and that a reviewer — human or agent — is
 * one step away from reporting as a platform gap nobody verified.
 *
 * This tool splits the two:
 *   - a source with evidence stays as `platforms/<source>.json`
 *   - a source with none moves to `platforms/_discovery.json`, which states the
 *     status and says explicitly that these are not platforms
 *
 * Usage
 *   node scripts/consolidate-platforms.js             # every pack
 *   node scripts/consolidate-platforms.js <packId> …  # named packs
 *   node scripts/consolidate-platforms.js --dry-run
 *
 * Idempotent. Deleting nothing that carries evidence.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKS_DIR = path.join(ROOT, 'data', 'brand-packs');
const LEDGER = '_discovery.json';
const NOTE = 'Sources listed here were searched but no profile URL was discovered. '
    + 'They are not platforms and must not be counted as a platform gap.';

/** Mirrors `_has_platform_evidence` in crawler-combined.py. */
const SEARCH_URL_MARKERS = ['bing.com/search', 'google.com/search', 'duckduckgo.com/html',
    'search.yahoo.com', 'search.brave.com'];

function isSearchUrl(url) {
    const text = String(url || '').toLowerCase();
    return SEARCH_URL_MARKERS.some((marker) => text.includes(marker));
}

function hasEvidence(data) {
    if (!data || typeof data !== 'object') return false;
    if (data.ok) return true;
    // A search-results URL is where a connector looked, not a profile it found.
    if (data.url && !isSearchUrl(data.url)) return true;
    for (const key of ['business', 'reviews', 'rating', 'posts', 'profile']) {
        const value = data[key];
        if (Array.isArray(value) && value.length) return true;
        if (value && typeof value === 'object' && Object.values(value).some(Boolean)) return true;
        if (typeof value === 'number' && value) return true;
    }
    return false;
}

async function readJson(file, fallback) {
    try {
        return JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch {
        return fallback;
    }
}

async function listPackIds(wanted) {
    const entries = await fsp.readdir(PACKS_DIR, { withFileTypes: true });
    const ids = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name);
    return wanted.length ? ids.filter((id) => wanted.includes(id)) : ids;
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const wanted = args.filter((arg) => !arg.startsWith('--'));
    const packIds = await listPackIds(wanted);

    if (wanted.length) {
        const unknown = wanted.filter((id) => !packIds.includes(id));
        if (unknown.length) {
            console.error(`Unknown pack(s): ${unknown.join(', ')}`);
            process.exit(2);
        }
    }

    let kept = 0;
    let moved = 0;
    let ledgers = 0;

    for (const packId of packIds) {
        const packDir = path.join(PACKS_DIR, packId);
        const pack = await readJson(path.join(packDir, 'pack.json'), null);
        const brands = pack?.pack?.brands || [];
        for (const brand of brands) {
            const dir = path.join(packDir, 'files', brand.id, 'social', 'platforms');
            let names;
            try {
                names = await fsp.readdir(dir);
            } catch {
                continue;
            }
            const shells = [];
            for (const name of names.filter((n) => n.endsWith('.json') && !n.startsWith('_'))) {
                const file = path.join(dir, name);
                const data = await readJson(file, null);
                if (hasEvidence(data)) {
                    kept += 1;
                    continue;
                }
                shells.push({ name, file, data: data || {} });
            }
            if (!shells.length) continue;

            const ledgerFile = path.join(dir, LEDGER);
            const ledger = await readJson(ledgerFile, {});
            for (const shell of shells) {
                const source = shell.name.replace(/\.json$/, '');
                ledger[source] = {
                    url: shell.data.url ?? null,
                    mode: shell.data.mode ?? null,
                    checked_at: shell.data.fetched_at ?? null,
                    warnings: shell.data.warnings || [],
                    status: 'not_found',
                };
                moved += 1;
            }
            ledger._note = NOTE;

            if (!dryRun) {
                await fsp.writeFile(ledgerFile, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
                for (const shell of shells) await fsp.unlink(shell.file);
            }
            ledgers += 1;
            console.log(`${packId}/${brand.id}: ${shells.length} shell(s) -> ${LEDGER}`);
        }
    }

    const verb = dryRun ? 'would move' : 'moved';
    console.log(`\n${verb} ${moved} file(s); kept ${kept} with evidence; ${ledgers} ledger(s) ${dryRun ? 'planned' : 'written'}.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
