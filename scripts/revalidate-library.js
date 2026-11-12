#!/usr/bin/env node
'use strict';
/**
 * revalidate-library.js — refresh the animation statuses in data/library.
 *
 * Statuses are computed when the library is built. After the animations or the
 * compositions change, a track can be listed as "broken" while it plays fine
 * (or the other way round). This script re-runs the same validation the save
 * path uses, and also understands composition-style motion (layer keyframes).
 *
 * Usage
 *   node scripts/revalidate-library.js [--dry]
 */
const path = require('node:path');
const { auditLibrary, revalidateLibrary } = require('../src/server/library-validation.js');

const ROOT = path.resolve(__dirname, '..');
const options = {
    root: ROOT,
    libraryDir: path.join(ROOT, 'data', 'library'),
    projectsDir: path.join(ROOT, 'data', 'projects'),
};
const dry = process.argv.includes('--dry');

(async () => {
    const { changes } = dry ? await auditLibrary(options) : await revalidateLibrary(options);
    console.log(`${changes.length} animation status${changes.length === 1 ? '' : 'es'} ${dry ? 'would change' : 'changed'}`);
    changes.forEach((change) => console.log(`  ${change.design} / ${change.animation}: ${change.from} → ${change.to}${change.issues.length ? ` (${change.issues.slice(0, 2).join('; ')})` : ''}`));
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
