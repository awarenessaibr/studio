'use strict';
/**
 * library-validation.js — audit animation statuses in data/library.
 *
 * The library is generated outside Studio, so an animation status can go stale
 * when a composition or a motion file changes. This module re-runs the same
 * validation the save path uses, and understands composition-style motion
 * (layer keyframes) through the shared normaliser.
 */
const fs = require('node:fs');
const path = require('node:path');
const LibraryService = require('./library-service.js');
const Normalize = require('../shared/animation-normalize.js');

async function auditLibrary({ libraryDir, projectsDir, root = process.cwd() }) {
    const index = await LibraryService.readIndex(libraryDir);
    const changes = [];
    for (const design of index.designs || []) {
        let detail = null;
        let candidates = [];
        try {
            detail = await LibraryService.readDesign(libraryDir, design.id);
            candidates = await LibraryService.compositionCandidates(detail, projectsDir);
        } catch {
            // A design without a readable composition cannot validate its motion.
        }
        for (const entry of design.animations || []) {
            let payload;
            try {
                payload = JSON.parse(fs.readFileSync(path.join(root, String(entry.file || '').replace(/^\//, '')), 'utf8'));
            } catch {
                continue;
            }
            const normal = Normalize.normalize(payload, entry);
            let status = entry.status;
            let issues = entry.issues || [];
            if (!normal.tracks.length) {
                status = entry.sourceVideo || payload.sourceVideo ? 'ok' : 'broken';
                issues = status === 'ok' ? [] : ['No animation tracks or layer keyframes.'];
            } else if (detail) {
                const target = normal.composition
                    || (candidates.length ? LibraryService.resolveComposition(candidates, normal.animation).composition : null);
                if (!target) continue;
                const validation = LibraryService.validateAnimation(detail, target, normal.animation);
                status = validation.status;
                issues = validation.issues;
            }
            if (status !== entry.status || JSON.stringify(issues) !== JSON.stringify(entry.issues || [])) {
                changes.push({
                    design: design.id,
                    animation: entry.id,
                    from: entry.status,
                    to: status,
                    issues,
                    entry,
                });
            }
        }
    }
    return { index, changes };
}

function applyChanges(changes) {
    changes.forEach((change) => {
        change.entry.status = change.to;
        change.entry.issues = change.issues;
    });
}

async function syncDetails(libraryDir, index) {
    const dir = path.join(libraryDir, 'designs');
    for (const design of index.designs || []) {
        const file = path.join(dir, `${design.id}.json`);
        let detail;
        try { detail = JSON.parse(await fs.promises.readFile(file, 'utf8')); } catch { continue; }
        if (!Array.isArray(detail.animations) || !Array.isArray(design.animations)) continue;
        const byId = new Map(design.animations.map((entry) => [entry.id, entry]));
        let touched = false;
        detail.animations = detail.animations.map((entry) => {
            const summary = byId.get(entry.id);
            if (!summary) return entry;
            if (summary.status === entry.status && JSON.stringify(summary.issues || []) === JSON.stringify(entry.issues || [])) return entry;
            touched = true;
            return { ...entry, status: summary.status, issues: summary.issues || [] };
        });
        if (touched) await fs.promises.writeFile(file, `${JSON.stringify(detail, null, 2)}\n`);
    }
}

async function revalidateLibrary(options) {
    const result = await auditLibrary(options);
    applyChanges(result.changes);
    result.index.generatedAt = new Date().toISOString();
    await fs.promises.writeFile(path.join(options.libraryDir, 'index.json'), `${JSON.stringify(result.index, null, 2)}\n`);
    await syncDetails(options.libraryDir, result.index);
    return result;
}

module.exports = { auditLibrary, applyChanges, revalidateLibrary };
