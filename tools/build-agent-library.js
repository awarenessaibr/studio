#!/usr/bin/env node
'use strict';

/**
 * Rebuild the HTML → Agent library index.
 *
 * Run after `image-to-layers/tools/html-to-projects.py` has written new
 * projects into `data/projects`:
 *
 *   node tools/build-agent-library.js
 *
 * The server also exposes POST /api/agent-library/rebuild.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const { buildAgentLibrary, summaryOf } = require('../src/server/agent-library.js');

const ROOT = path.join(__dirname, '..');

async function main() {
    const projectsDir = path.resolve(process.env.STUDIO_PROJECTS_DIR || path.join(ROOT, 'data', 'projects'));
    const brandPacksDir = path.resolve(process.env.STUDIO_BRAND_PACKS_DIR || path.join(ROOT, 'data', 'brand-packs'));
    const outFile = path.resolve(process.env.STUDIO_AGENT_LIBRARY_FILE || path.join(ROOT, 'data', 'settings', 'agent-library.json'));
    const started = Date.now();
    const library = await buildAgentLibrary({ projectsDir, brandPacksDir });
    await fsp.mkdir(path.dirname(outFile), { recursive: true });
    await fsp.writeFile(outFile, JSON.stringify(library), 'utf8');
    const summary = summaryOf(library);
    console.log(`agent library: ${summary.counts.compositions} compositions, ${summary.counts.businesses} businesses, ${summary.counts.groups} groups, ${summary.counts.animations} animations (${Date.now() - started} ms)`);
    console.log(`wrote ${path.relative(ROOT, outFile)} (${(JSON.stringify(library).length / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
