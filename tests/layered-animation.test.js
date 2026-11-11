'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
    SPRITE_URLS,
    createCyclistAnimation,
    createLayeredAnimation,
} = require('../src/client/studio/layered-animation.js');

const tracks = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../src/client/studio/animations/butterfly-pig/motion-tracks.json'),
    'utf8',
));
const cyclistTracks = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../src/client/studio/animations/cyclist/motion-tracks.json'),
    'utf8',
));

test('creates all butterfly and pig motion as editable scene layers', () => {
    const { duration, layers } = createLayeredAnimation(
        tracks,
        { width: tracks.canvas.width, height: tracks.canvas.height },
        { zStart: 10, idPrefix: 'test-butterfly-pig' },
    );

    assert.equal(duration, 24600);
    assert.equal(layers.length, 31);
    assert.equal(layers.filter((layer) => layer.segmentGroup === 'Stage').length, 1);
    assert.equal(new Set(layers.map((layer) => layer.id)).size, layers.length);
    assert.equal(layers.filter((layer) => layer.segmentGroup === 'Pig').length, 2);
    assert.equal(layers.filter((layer) => layer.segmentGroup.startsWith('Butterfly ')).length, 28);
    const stage = layers.find((layer) => layer.segmentGroup === 'Stage');
    assert.equal(stage.url, '/src/client/studio/animations/butterfly-pig/stage.png');
    assert.equal(stage.z, 9);
    assert.ok(layers.find((layer) => layer.name === 'Pig (right-facing)').z > stage.z);
    assert.equal(layers.find((layer) => layer.name === 'Pig (right-facing)').keyframes.length, 1477);
    const firstPig = layers.find((layer) => layer.name === 'Pig (right-facing)').keyframes[0];
    const sourceHeight = 135 * (0.78 + 0.4 * ((470 - 345) / 190));
    const sourceWidth = sourceHeight * 717 / 549;
    assert.equal(firstPig.time, 0);
    assert.equal(firstPig.rotation, 0);
    assert.equal(firstPig.opacity, 1);
    assert.ok(Math.abs(firstPig.x - (250 - sourceWidth / 2) / 1004 * 100) < 1e-3);
    assert.ok(Math.abs(firstPig.y - (470 - sourceHeight) / 650 * 100) < 1e-3);
    assert.ok(Math.abs(firstPig.w - sourceWidth / 1004 * 100) < 1e-3);
    assert.ok(Math.abs(firstPig.h - sourceHeight / 650 * 100) < 1e-3);
    assert.ok(layers.find((layer) => layer.name === 'Pig (right-facing)').z
        < layers.find((layer) => layer.name === 'Butterfly 01 (right-facing)').z,
    'butterflies draw above the pig, as in the source');
    assert.ok(layers.find((layer) => layer.name === 'Pig (right-facing)').z
        > layers.find((layer) => layer.segmentGroup === 'Stage').z,
    'the stage field sits under every subject');
    assert.deepEqual(stage.keyframes, []);
    assert.ok(layers.filter((layer) => layer.segmentGroup !== 'Stage').every((layer) => layer.keyframes.length > 1
        && layer.keyframes.every((frame) => ['time', 'x', 'y', 'w', 'h', 'rotation', 'opacity']
            .every((property) => Number.isFinite(frame[property])))));
});

test('keeps butterflies hidden before their spawn time and switches facing variants', () => {
    const { layers } = createLayeredAnimation(
        tracks,
        { width: 1004, height: 650 },
        { idPrefix: 'test-butterfly-pig' },
    );
    const left = layers.find((layer) => layer.name === 'Butterfly 01 (left-facing)');
    const right = layers.find((layer) => layer.name === 'Butterfly 01 (right-facing)');

    assert.equal(left.url, SPRITE_URLS.butterfly.left);
    assert.equal(right.url, SPRITE_URLS.butterfly.right);
    assert.equal(left.keyframes[0].time, 0);
    assert.equal(left.keyframes[0].opacity, 0);
    assert.equal(right.keyframes[0].opacity, 0);
    assert.equal(left.keyframes[1].time, 817);
    assert.equal(left.keyframes[1].opacity, 0);
    assert.equal(right.keyframes[1].opacity, 1);
    assert.equal(layers.find((layer) => layer.name === 'Pig (left-facing)').url, SPRITE_URLS.pig.left);
});

test('fits the animation to the scene without distorting its aspect ratio', () => {
    const { layers } = createLayeredAnimation(
        tracks,
        { width: 1080, height: 1080 },
        { idPrefix: 'test-butterfly-pig' },
    );
    const rightPig = layers.find((layer) => layer.name === 'Pig (right-facing)');
    const frame = rightPig.keyframes[0];
    const originalRatio = (717 / 549);
    const fittedRatio = (frame.w / 100 * 1080) / (frame.h / 100 * 1080);

    assert.ok(Math.abs(originalRatio - fittedRatio) < 1e-10);
    assert.ok(frame.y > 0);
});

test('rejects invalid animation dimensions and layer identifiers', () => {
    assert.throws(
        () => createLayeredAnimation(tracks, { width: 0, height: 1080 }),
        /dimensions must be positive/,
    );
    assert.throws(
        () => createLayeredAnimation(tracks, { width: 1080, height: 1080 }, { idPrefix: 'bad id' }),
        /ID prefix is invalid/,
    );
});

test('imports the complete sidewalk-aligned cyclist ride as editable layers', () => {
    const { duration, layers } = createCyclistAnimation(
        cyclistTracks,
        { width: cyclistTracks.canvas.width, height: cyclistTracks.canvas.height },
        { zStart: 40, idPrefix: 'test-cyclist-ride' },
    );
    const frontWheel = layers.find((layer) => layer.name === 'bicycle-front-wheel');
    const torso = layers.find((layer) => layer.name === 'cyclist-torso');

    assert.equal(duration, 8000);
    assert.equal(layers.length, 6);
    assert.equal(new Set(layers.map((layer) => layer.id)).size, 6);
    assert.equal(frontWheel.keyframes.length, 81);
    assert.ok(Math.abs(frontWheel.keyframes[0].y - 59.479) < 1e-8);
    assert.ok(Math.abs(frontWheel.keyframes.at(-1).y - 65.164) < 1e-8);
    assert.ok(Math.abs(torso.keyframes[0].y - 53.381) < 1e-8);
    assert.ok(layers.every((layer) => layer.keyframes.length === 81
        && layer.keyframes.every((frame) => ['time', 'x', 'y', 'w', 'h', 'rotation', 'opacity']
            .every((property) => Number.isFinite(frame[property])))));
});

test('fits the cyclist ride to the target canvas without distorting layer geometry', () => {
    const { layers } = createCyclistAnimation(
        cyclistTracks,
        { width: 1080, height: 1080 },
        { zStart: 0, idPrefix: 'test-cyclist-ride' },
    );
    const frontWheel = layers.find((layer) => layer.name === 'bicycle-front-wheel');
    const frame = frontWheel.keyframes[0];
    const expectedRatio = (2.448 / 100 * cyclistTracks.canvas.width)
        / (4.254 / 100 * cyclistTracks.canvas.height);
    const actualRatio = (frame.w / 100 * 1080) / (frame.h / 100 * 1080);

    assert.ok(Math.abs(expectedRatio - actualRatio) < 1e-10);
    assert.ok(frame.y < frontWheel.keyframes.at(-1).y);
});

test('keeps the exact source sprites and stage dimensions', () => {
    const dir = path.join(__dirname, '../src/client/studio/animations/butterfly-pig');
    const files = {
        'pig-left': 'pig-left.png',
        'pig-right': 'pig-right.png',
        'butterfly-left': 'butterfly-left.png',
        'butterfly-right': 'butterfly-right.png',
    };
    const hashes = new Map();
    for (const [name, file] of Object.entries(files)) {
        const buffer = fs.readFileSync(path.join(dir, file));
        const digest = crypto.createHash('sha256').update(buffer).digest('hex');
        hashes.set(name, digest);
        assert.ok(buffer.length > 10_000, `${file} is a real sprite`);
    }
    assert.equal(tracks.canvas.width, 1004);
    assert.equal(tracks.canvas.height, 650);
    for (const [kind, facings] of Object.entries(tracks.sprites)) {
        for (const [facing, sprite] of Object.entries(facings)) {
            const name = `${kind}-${facing}`;
            assert.equal(sprite.sha256, hashes.get(name), `${name} hash matches the shipped file`);
            assert.equal(
                `${sprite.width}×${sprite.height}`,
                `${Number(sprite.width)}×${Number(sprite.height)}`,
            );
        }
    }
    const stageBuffer = fs.readFileSync(path.join(dir, 'stage.png'));
    assert.equal(crypto.createHash('sha256').update(stageBuffer).digest('hex'), tracks.stage.sha256);
    assert.equal(stageBuffer.readUInt32BE(16), 1004);
    assert.equal(stageBuffer.readUInt32BE(20), 650);
    const archiveFile = path.join(__dirname, '../data/library/sources/assets/butterfly-chase/assets.json');
    const archive = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
    assert.equal(archive.assets.length, 4);
    for (const asset of archive.assets) {
        assert.equal(hashes.get(asset.name), asset.sha256, `${asset.name} is byte-identical to the archived deck`);
    }
});

test('at every sampled frame the layer quad is the source draw quad', () => {
    const { layers } = createLayeredAnimation(
        tracks,
        { width: tracks.canvas.width, height: tracks.canvas.height },
        { idPrefix: 'test-butterfly-pig' },
    );
    const subjects = new Map(tracks.subjects.map((subject) => [subject.label, subject]));
    const samples = [0, 250, 700, 1200, 1476];
    for (const [label, subject] of subjects) {
        const frame = subject.frames.find((point) => samples.includes(Math.round(point.timeMs / 1000 * tracks.canvas.fps)));
        if (!frame) continue;
        const time = Math.round(frame.timeMs);
        const layer = layers.find((item) => item.name === `${label} (${frame.facing}-facing)`);
        assert.ok(layer, `${label} ${frame.facing} layer exists`);
        const keyframe = layer.keyframes.find((item) => item.time === time);
        assert.ok(keyframe, `${label} has a keyframe at ${time} ms`);
        assert.equal(keyframe.opacity, 1, `${label} is visible while facing ${frame.facing}`);
        const centerX = keyframe.x / 100 * tracks.canvas.width + keyframe.w / 100 * tracks.canvas.width / 2;
        const centerY = keyframe.y / 100 * tracks.canvas.height + keyframe.h / 100 * tracks.canvas.height / 2;
        const width = keyframe.w / 100 * tracks.canvas.width;
        const height = keyframe.h / 100 * tracks.canvas.height;
        assert.ok(Math.abs(centerX - frame.x) < 1e-3, `${label} centre x is the source draw centre`);
        assert.ok(Math.abs(centerY - frame.y) < 1e-3, `${label} centre y is the source draw centre`);
        assert.ok(Math.abs(width - frame.dw * frame.sx) < 1e-3, `${label} width is the drawn width`);
        assert.ok(Math.abs(height - frame.dh * frame.sy) < 1e-3, `${label} height is the drawn height`);
        assert.ok(Math.abs(keyframe.rotation - frame.rotation) < 1e-9, `${label} rotation is the source rotation`);
    }
});
