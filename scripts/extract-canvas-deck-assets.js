#!/usr/bin/env node
'use strict';
/**
 * extract-canvas-deck-assets.js — archive the exact images and fonts embedded
 * in a canvas deck, with hashes, so "the template's images" are provable
 * rather than re-encoded.
 *
 * The decks carry every photograph, sprite and webfont as a data URI. This
 * script decodes those bytes unchanged into
 *   data/library/sources/assets/<deck>/
 * and records the provenance in assets.json (byte size, pixel size, sha256).
 *
 * Usage
 *   node scripts/extract-canvas-deck-assets.js scripts/source-manifests/<manifest>.json
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const manifestFile = process.argv[2];
if (!manifestFile) {
    console.error('Usage: node scripts/extract-canvas-deck-assets.js <manifest.json>');
    process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(path.resolve(ROOT, manifestFile), 'utf8'));
const assetsRoot = path.join(ROOT, 'data', 'library', 'sources', 'assets');

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const KNOWN_NAMES = {
    pigL: 'pig-left',
    pigR: 'pig-right',
    bfL: 'butterfly-left',
    bfR: 'butterfly-right',
    poster: 'poster',
    burger: 'burger',
    xmas: 'xmas',
    xmasTop: 'xmas-top',
    jazz: 'jazz',
    avatar: 'avatar',
};

function kebab(value) {
    return String(value)
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();
}

function pngSize(buffer) {
    if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegSize(buffer) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) { offset += 1; continue; }
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
    }
    return null;
}

function imageSize(buffer) {
    return pngSize(buffer) || jpegSize(buffer) || { width: null, height: null };
}

function dataUriAssets(html) {
    const found = new Map();
    const script = (html.match(/<script[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '';
    const keyed = /["']?([A-Za-z0-9_]+)["']?\s*:\s*["'](data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+))["']/g;
    let match;
    while ((match = keyed.exec(script))) {
        const [, key, , mime, data] = match;
        if (!found.has(key)) found.set(key, { key, mime, data });
    }
    // Ordered IMG maps (e.g. the chase sprites) use the same key: "data:…" form.
    const styleFonts = /@font-face\s*\{([\s\S]*?)\}/g;
    const fonts = [];
    while ((match = styleFonts.exec(html))) {
        const block = match[1];
        const src = block.match(/url\(["']?(data:font\/(\w+);base64,([A-Za-z0-9+/=]+))["']?\)/);
        if (!src) continue;
        const family = (block.match(/font-family\s*:\s*([^;]+)/) || [])[1] || 'font';
        const weight = (block.match(/font-weight\s*:\s*([^;]+)/) || [])[1] || '400';
        const style = (block.match(/font-style\s*:\s*([^;]+)/) || [])[1] || 'normal';
        fonts.push({
            key: `${family.trim()} ${weight.trim()} ${style.trim()}`,
            family: family.trim(),
            weight: weight.trim(),
            style: style.trim(),
            mime: `font/${src[2]}`,
            data: src[3],
        });
    }
    return { images: [...found.values()], fonts };
}

for (const source of manifest.sources) {
    const file = path.resolve(ROOT, source.file);
    if (!fs.existsSync(file)) throw new Error(`Source not found: ${file}`);
    const html = fs.readFileSync(file, 'utf8');
    const slug = path.basename(source.file, '.html');
    const dir = path.join(assetsRoot, slug);
    fs.mkdirSync(dir, { recursive: true });
    const { images, fonts } = dataUriAssets(html);
    const assets = [];
    const used = new Set();

    for (const image of images) {
        const buffer = Buffer.from(image.data, 'base64');
        const extension = image.mime === 'image/png' ? 'png' : image.mime === 'image/webp' ? 'webp' : 'jpg';
        let name = KNOWN_NAMES[image.key] || kebab(image.key);
        if (!name) name = 'asset';
        while (used.has(name)) name = `${name}-2`;
        used.add(name);
        const fileName = `${name}.${extension}`;
        const target = path.join(dir, fileName);
        fs.writeFileSync(target, buffer);
        const size = imageSize(buffer);
        assets.push({
            name,
            key: image.key,
            kind: 'image',
            mime: image.mime,
            file: `/data/library/sources/assets/${slug}/${fileName}`,
            width: size.width,
            height: size.height,
            bytes: buffer.length,
            sha256: sha(buffer),
            dataUriSha256: sha(image.data),
        });
    }
    for (const font of fonts) {
        const buffer = Buffer.from(font.data, 'base64');
        let name = kebab(`${font.family}-${font.style === 'normal' ? '' : `${font.style}-`}${font.weight}`) || 'font';
        while (used.has(name)) name = `${name}-2`;
        used.add(name);
        const extension = font.mime.split('/')[1] || 'woff';
        const fileName = `${name}.${extension}`;
        fs.writeFileSync(path.join(dir, fileName), buffer);
        assets.push({
            name,
            key: font.key,
            kind: 'font',
            family: font.family,
            weight: font.weight,
            style: font.style,
            mime: font.mime,
            file: `/data/library/sources/assets/${slug}/${fileName}`,
            width: null,
            height: null,
            bytes: buffer.length,
            sha256: sha(buffer),
            dataUriSha256: sha(font.data),
        });
    }

    const record = {
        schema: 'agent-studio/source-assets/1',
        source: source.file,
        sourceSha256: sha(fs.readFileSync(file)),
        extractedAt: new Date().toISOString(),
        assets,
    };
    fs.writeFileSync(path.join(dir, 'assets.json'), `${JSON.stringify(record, null, 2)}\n`);
    console.log(`${slug}: ${assets.length} asset(s), ${assets.reduce((sum, asset) => sum + asset.bytes, 0)} bytes`);
    assets.forEach((asset) => console.log(`  ${asset.kind.padEnd(5)} ${asset.name} — ${asset.width || '—'}×${asset.height || '—'}, ${asset.sha256.slice(0, 12)}`));
}
