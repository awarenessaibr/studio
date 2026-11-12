'use strict';
/**
 * cleanup-legacy-motions.js — remove motion entries that no surface can play.
 *
 * Two known dead shapes:
 *   - cue/type-only scene animations (no layers, no tracks): the old
 *     studio-scene-animation format, never rendered by AFS/Studio/Project canvas;
 *   - an "Original motion" whose file has no tracks, no layers and no source
 *     recording. It made Butterfly-The-Stairs "blocked" even though its three
 *     real motions work.
 *
 * Files are archived, not deleted. The library index and the design detail are
 * updated together so Studio Agent, AFS, Project canvas and the review matrix
 * all agree.
 *
 *   node scripts/cleanup-legacy-motions.js          # dry run
 *   node scripts/cleanup-legacy-motions.js --apply  # write + archive
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LIBRARY = path.join(ROOT, 'data', 'library');
const INDEX = path.join(LIBRARY, 'index.json');
const DESIGNS = path.join(LIBRARY, 'designs');
const ARCHIVE = path.join(LIBRARY, '_archive', 'legacy-motions');
const APPLY = process.argv.includes('--apply');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const diskPath = (url) => path.join(ROOT, String(url || '').replace(/^\//, ''));

function archive(file, designId) {
    if (!fs.existsSync(file)) return null;
    const dir = path.join(ARCHIVE, designId);
    fs.mkdirSync(dir, { recursive: true });
    let target = path.join(dir, path.basename(file));
    let n = 2;
    while (fs.existsSync(target)) target = path.join(dir, `${path.basename(file, '.json')}-${n++}.json`);
    fs.renameSync(file, target);
    return path.relative(ROOT, target);
}

function isDead(entry, payload) {
    const layers = Array.isArray(payload.layers) ? payload.layers.length : 0;
    const tracks = Array.isArray(payload.tracks) ? payload.tracks.length : 0;
    const cueOnly = String(payload.type || '') === 'studio-scene-animation' && !layers && !tracks;
    const emptyOriginal = entry.origin === 'original' && !layers && !tracks && !payload.sourceVideo;
    return { dead: cueOnly || emptyOriginal, kind: cueOnly ? 'legacy cue animation' : 'empty original' };
}

function main() {
    if (!fs.existsSync(INDEX)) throw new Error(`No library index at ${INDEX}`);
    fs.mkdirSync(ARCHIVE, { recursive: true });
    const index = readJson(INDEX);
    const changes = [];
    const moves = [];

    for (const design of index.designs || []) {
        const detailFile = path.join(DESIGNS, `${design.id}.json`);
        const detail = fs.existsSync(detailFile) ? readJson(detailFile) : null;
        const removed = [];
        for (const entry of [...(design.animations || [])]) {
            const file = diskPath(entry.file);
            let payload;
            try { payload = readJson(file); } catch { continue; }
            const verdict = isDead(entry, payload);
            if (!verdict.dead) continue;
            // Never strip the last motion from a design; remove a dead original
            // only when a real motion remains.
            if (verdict.kind === 'empty original') {
                const remaining = (design.animations || []).filter((item) => item.id !== entry.id).length;
                if (!remaining) continue;
            }
            removed.push({ entry, file, kind: verdict.kind });
        }
        if (!removed.length) continue;

        for (const item of removed) {
            // Cue animations are still used by the repository scene-animation
            // feature (Studio's scene variants), so remove only the library
            // entry and keep the project file. Empty originals are archived.
            const keepFile = item.kind === 'legacy cue animation';
            const archived = keepFile
                ? 'kept in project animations; library entry removed'
                : (APPLY ? archive(item.file, design.id) : path.relative(ROOT, path.join(ARCHIVE, design.id, path.basename(item.file))));
            changes.push({ design: design.id, animation: item.entry.id, name: item.entry.name, kind: item.kind, archived });
            if (APPLY && !keepFile) moves.push(item.file);
        }
        if (!APPLY) continue;

        const removedIds = new Set(removed.map((item) => item.entry.id));
        const current = new Map((design.animations || []).map((entry) => [entry.id, entry]));
        design.animations = (design.animations || []).filter((entry) => !removedIds.has(entry.id));
        if (detail) {
            detail.animations = (detail.animations || [])
                .filter((entry) => !removedIds.has(entry.id))
                .map((entry) => {
                    const summary = current.get(entry.id);
                    return summary ? { ...entry, status: summary.status, issues: summary.issues || [] } : entry;
                });
            design.animations = detail.animations;
            const removedNames = new Set(removed.map((item) => item.entry.name));
            detail.issues = (detail.issues || []).filter((issue) => {
                const message = String(issue && issue.message || '');
                return !/Original motion is not usable|No animation tracks or layer keyframes/.test(message)
                    && ![...removedNames].some((name) => message.includes(String(name)));
            });
            if (detail.status === 'blocked' && !detail.issues.some((issue) => issue.severity === 'blocked')) {
                detail.status = 'review';
                detail.cleanedAt = new Date().toISOString();
            }
            design.status = detail.status;
            design.issues = (detail.issues || []).length;
            writeJson(detailFile, detail);
        }
    }

    if (APPLY && changes.length) {
        index.counts = { ...(index.counts || {}) };
        index.counts.designs = index.designs.length;
        index.counts.ready = index.designs.filter((design) => design.status === 'ready').length;
        index.counts.review = index.designs.filter((design) => design.status === 'review').length;
        index.generatedAt = new Date().toISOString();
        writeJson(INDEX, index);
    }

    const mode = APPLY ? 'archived + updated' : 'would remove (dry run)';
    console.log(`${changes.length} dead motion${changes.length === 1 ? '' : 's'} ${mode}`);
    for (const change of changes) {
        console.log(`  ${change.design} · ${change.animation} (${change.kind}) → ${change.archived}`);
    }
    if (!APPLY && changes.length) console.log('\nRun with --apply to archive the files and update the index/detail.');
}

main();
