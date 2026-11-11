#!/usr/bin/env node
'use strict';

/**
 * wire-segmentation-project.js — import an image-to-layers `<project>-segmented`
 * export into its Studio project.
 *
 * Usage
 *   node scripts/wire-segmentation-project.js <project>-segmented
 *   node scripts/wire-segmentation-project.js <id> --target <project> --image images/poster.png
 *   node scripts/wire-segmentation-project.js <id> --check --json
 *
 * Options
 *   --target <id>       target project (default: strip -segmented from the id)
 *   --image <path>      target image, relative to the project (default: poster.png)
 *   --layer <id>        target layer id (wins over --image)
 *   --keep-source       keep the provisional <id> project instead of archiving it
 *   --check             validate and report without writing or moving anything
 *   --json              print one JSON object (used by the image-to-layers app)
 */

const path = require('node:path');
const Wiring = require('../src/server/segmentation-wiring.js');

function parseArgs(argv) {
    const options = { check: false, keepSource: false, json: false };
    const positional = [];
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--check') options.check = true;
        else if (arg === '--json') options.json = true;
        else if (arg === '--keep-source') options.keepSource = true;
        else if (arg === '--target') options.targetProjectId = argv[++index];
        else if (arg === '--image') options.imagePath = argv[++index];
        else if (arg === '--layer') options.layerId = argv[++index];
        else if (arg === '--help' || arg === '-h') options.help = true;
        else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
        else positional.push(arg);
    }
    options.segId = positional[0] ? path.basename(positional[0]) : '';
    return options;
}

function usage() {
    return [
        'Usage: node scripts/wire-segmentation-project.js <project>-segmented [options]',
        '',
        'Options: --target <id>  --image <path>  --layer <id>  --keep-source  --check  --json',
    ].join('\n');
}

function main() {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        process.exit(2);
    }
    if (options.help) {
        console.log(usage());
        return;
    }
    if (!options.segId) {
        console.error(usage());
        process.exit(2);
    }
    try {
        const report = Wiring.wireSegmentationExport(options.segId, options);
        if (options.json) {
            console.log(JSON.stringify(report));
            return;
        }
        console.log(`[segmentation] ${options.check ? 'check' : 'wired'}: ${report.segmentedProjectId}`);
        console.log(`[segmentation] target: ${report.targetProjectId} · parent: ${report.parent.name} (${report.parent.id}) · image: ${report.image.path}`);
        console.log(`[segmentation] ${report.counts.parts} parts · ${report.counts.groups} groups · composition: ${report.compositionFile}`);
        for (const group of report.groups) {
            console.log(`  ${group.label}: ${group.count} (z ${group.z[0]}–${group.z[1]})`);
        }
        if (report.archivedTo) console.log(`[segmentation] source archived under ${report.archivedTo}`);
        if (report.compositionUrl) console.log(`[segmentation] open: ${report.compositionUrl}`);
        if (report.check) console.log('[segmentation] check only — nothing written');
    } catch (error) {
        if (options && options.json) {
            console.log(JSON.stringify({ error: error.message, status: error.status || 500 }));
        } else {
            console.error(`[segmentation] ${error.message}`);
        }
        process.exit(1);
    }
}

main();
