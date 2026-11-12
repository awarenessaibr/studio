'use strict';
/**
 * Thumbnail service: cached, resized covers for catalogue rows.
 *
 * Run with: node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const Thumbnails = require('../src/server/thumbnail-service.js');

const FFMPEG = String(process.env.STUDIO_FFMPEG || 'ffmpeg').trim() || 'ffmpeg';

function hasFfmpeg() {
    try {
        execFileSync(FFMPEG, ['-hide_banner', '-version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

const AVAILABLE = hasFfmpeg();

async function makeSource(dir) {
    const source = path.join(dir, 'source.png');
    execFileSync(FFMPEG, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=0x334455:s=320x200',
        '-frames:v', '1', source,
    ], { stdio: 'ignore' });
    return source;
}

test('thumbnail widths are clamped to the supported range', () => {
    assert.equal(Thumbnails.clampWidth(undefined), Thumbnails.DEFAULT_WIDTH);
    assert.equal(Thumbnails.clampWidth(''), Thumbnails.DEFAULT_WIDTH);
    assert.equal(Thumbnails.clampWidth('not-a-number'), Thumbnails.DEFAULT_WIDTH);
    assert.equal(Thumbnails.clampWidth(1), Thumbnails.MIN_WIDTH);
    assert.equal(Thumbnails.clampWidth(9999), Thumbnails.MAX_WIDTH);
    assert.equal(Thumbnails.clampWidth('180'), 180);
});

test('a thumbnail is generated once per source mtime and width', { skip: !AVAILABLE && 'ffmpeg is not installed' }, async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'studio-thumbnail-'));
    try {
        const source = await makeSource(dir);
        const cacheDir = path.join(dir, 'cache');
        const first = await Thumbnails.ensureThumbnail({
            sourceFile: source,
            sourceKey: '/data/projects/demo/images/source.png',
            width: 160,
            cacheDir,
        });
        assert.equal(first.width, 160);
        assert.match(first.file, /\.jpg$/);
        const data = await fsp.readFile(first.file);
        assert.deepEqual([...data.subarray(0, 3)], [0xff, 0xd8, 0xff], 'the cover is a JPEG');

        const firstStat = await fsp.stat(first.file);
        const again = await Thumbnails.ensureThumbnail({
            sourceFile: source,
            sourceKey: '/data/projects/demo/images/source.png',
            width: 160,
            cacheDir,
        });
        assert.equal(again.file, first.file, 'the second call reuses the cache');
        assert.equal((await fsp.stat(again.file)).mtimeMs, firstStat.mtimeMs);

        const narrow = await Thumbnails.ensureThumbnail({
            sourceFile: source,
            sourceKey: '/data/projects/demo/images/source.png',
            width: 64,
            cacheDir,
        });
        assert.notEqual(narrow.file, first.file, 'a different width is a different cover');
        assert.equal(narrow.width, 64);
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('non-raster and missing sources are rejected', { skip: !AVAILABLE && 'ffmpeg is not installed' }, async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'studio-thumbnail-'));
    try {
        const text = path.join(dir, 'source.svg');
        await fsp.writeFile(text, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
        await assert.rejects(
            Thumbnails.ensureThumbnail({
                sourceFile: text,
                sourceKey: '/data/x.svg',
                width: 160,
                cacheDir: path.join(dir, 'cache'),
            }),
            (error) => error.status === 415,
        );
        await assert.rejects(
            Thumbnails.ensureThumbnail({
                sourceFile: path.join(dir, 'missing.png'),
                sourceKey: '/data/missing.png',
                width: 160,
                cacheDir: path.join(dir, 'cache'),
            }),
            (error) => error.status === 404,
        );
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});
