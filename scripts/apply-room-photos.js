#!/usr/bin/env node
'use strict';
/**
 * apply-room-photos.js — project the downloaded room photography into the
 * brand's content and pack.
 *
 * The images themselves are fetched once into
 * `files/<brand>/assets/photography/rooms/` and described by
 * `files/<brand>/sources/room-photos.json` (remote URL, local file, size).
 * This script is the deterministic bridge from that manifest to the two
 * places the studio reads:
 *
 *   content.venue.rooms[].image / gallery   pack-relative paths
 *   brand.photography[]                   served URLs for the Image tab
 *
 * It is idempotent: re-running it after adding a photo to the manifest only
 * adds the new entry. Room notes, capacities and the rest of the content are
 * left alone.
 *
 * Usage
 *   node scripts/apply-room-photos.js --pack=<packId> [--brand=<brandId>] [--dry-run]
 */
const fs = require('node:fs');
const path = require('node:path');

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
            console.log('Usage: node scripts/apply-room-photos.js --pack=<packId> [--brand=<brandId>] [--dry-run]');
            process.exit(0);
        } else {
            console.error(`Unknown option: ${arg}`);
            process.exit(2);
        }
    });
    if (!options.pack) {
        console.error('--pack is required.');
        process.exit(2);
    }
    return options;
}

function contentFile(packDir, brand) {
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

function photoUrl(packId, brandId, file) {
    return `/api/brand-packs/${packId}/files/${brandId}/${file}`;
}

function photoEntries(packId, brandId, manifest) {
    const entries = [];
    Object.entries(manifest.rooms || {}).forEach(([roomId, room]) => {
        const name = room.name || roomId;
        const card = room.card || {};
        if (card.file) {
            entries.push({
                name,
                url: photoUrl(packId, brandId, card.file),
                path: card.file,
                width: Number.isFinite(Number(card.width)) ? Number(card.width) : null,
                height: Number.isFinite(Number(card.height)) ? Number(card.height) : null,
            });
        }
        (Array.isArray(room.gallery) ? room.gallery : []).forEach((photo, index) => {
            if (!photo || !photo.file) return;
            entries.push({
                name: `${name} · gallery ${index + 2}`,
                url: photoUrl(packId, brandId, photo.file),
                path: photo.file,
                width: Number.isFinite(Number(photo.width)) ? Number(photo.width) : null,
                height: Number.isFinite(Number(photo.height)) ? Number(photo.height) : null,
            });
        });
    });
    return entries;
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const packDir = path.join(PACKS, options.pack);
    const packFile = path.join(packDir, 'pack.json');
    if (!fs.existsSync(packFile)) {
        console.error(`Pack “${options.pack}” not found.`);
        process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(packFile, 'utf8'));
    const pack = raw.pack || raw;
    let changed = 0;
    let skipped = 0;

    (pack.brands || []).forEach((brand) => {
        if (options.brand && brand.id !== options.brand) return;
        const source = contentFile(packDir, brand);
        if (!source) return;
        const brandRoot = path.dirname(path.dirname(source));
        const manifestFile = path.join(brandRoot, 'sources', 'room-photos.json');
        if (!fs.existsSync(manifestFile)) return;
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        const content = JSON.parse(fs.readFileSync(source, 'utf8'));
        const rooms = content?.venue?.rooms;
        if (!Array.isArray(rooms) || !rooms.length) return;

        // Content: the manifest is the source for image paths only.
        const bySlug = new Map();
        Object.entries(manifest.rooms || {}).forEach(([slug, room]) => {
            bySlug.set(slug, room);
        });
        let contentChanged = false;
        rooms.forEach((room, index) => {
            const slug = String(room.id || room.name || '').toLowerCase()
                .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            const source2 = bySlug.get(slug) || bySlug.get(Object.keys(manifest.rooms || {})[index]);
            if (!source2 || !source2.card || !source2.card.file) return;
            const image = source2.card.file;
            const gallery = (Array.isArray(source2.gallery) ? source2.gallery : [])
                .map((photo) => photo.file).filter(Boolean);
            if (room.image !== image || JSON.stringify(room.gallery || []) !== JSON.stringify(gallery)) {
                room.image = image;
                room.gallery = gallery;
                contentChanged = true;
            }
        });

        // Pack: rebuild only the room photo block so hand-added photography
        // outside `assets/photography/rooms/` survives.
        const entries = photoEntries(options.pack, brand.id, manifest);
        const photography = (Array.isArray(brand.photography) ? brand.photography : [])
            .filter((photo) => !String(photo.path || '').startsWith('assets/photography/rooms/'));
        const next = photography.concat(entries);
        const packChanged = JSON.stringify(next) !== JSON.stringify(brand.photography || []);
        if (packChanged) brand.photography = next;

        if (!contentChanged && !packChanged) {
            skipped += 1;
            console.log(`· ${brand.id} already in sync (${entries.length} room photos)`);
            return;
        }
        if (!options.dryRun) {
            if (contentChanged) fs.writeFileSync(source, `${JSON.stringify(content, null, 2)}\n`);
            const stamp = new Date().toISOString();
            raw.updatedAt = stamp;
            pack.updatedAt = stamp;
            fs.writeFileSync(packFile, `${JSON.stringify(raw, null, 2)}\n`);
        }
        changed += 1;
        console.log(`${options.dryRun ? '·' : '✓'} ${brand.id} ← ${path.relative(ROOT, manifestFile)} (${entries.length} room photos)`);
    });

    console.log(`${options.dryRun ? 'Would update' : 'Updated'} ${changed} brand${changed === 1 ? '' : 's'} · ${skipped} already in sync`);
}

main();
