'use strict';
/**
 * The narrated cut keeps its promises: the bubble cards are timed from the
 * voice, the deck carries the same windows, and the recording, the mix and the
 * library entry all agree on one duration.
 *
 * Run with: node --test "tests/*.test.js"
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'data', 'library');
const MANIFEST = path.join(LIB, 'sources', 'narrated.json');
const hasCut = fs.existsSync(MANIFEST);

function probe(file) {
    return JSON.parse(execFileSync('ffprobe', [
        '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate',
        '-show_entries', 'format=duration', '-of', 'json', file,
    ], { encoding: 'utf8' }));
}

test('the narrated cinematic-03 cut is one timeline across deck, audio and library', { skip: !hasCut }, () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const design = manifest.designs.find((item) => item.id === 'butterfly-the-pig---cinematic-03-narrated');
    assert.ok(design, 'the narrated cut is in the manifest');

    const timelinePath = path.join(ROOT, design.timeline);
    const timeline = JSON.parse(fs.readFileSync(timelinePath, 'utf8'));
    const detail = JSON.parse(fs.readFileSync(path.join(LIB, 'designs', `${design.id}.json`), 'utf8'));
    const index = JSON.parse(fs.readFileSync(path.join(LIB, 'index.json'), 'utf8'));
    const entry = index.designs.find((item) => item.id === design.id);
    assert.ok(entry, 'the design is in the catalogue');

    assert.equal(timeline.durationMs, design.duration);
    assert.equal(detail.duration, design.duration);
    assert.equal(entry.duration, design.duration);

    // Every card opens before the voice and closes after it, with no overlap.
    let previousEnd = 0;
    for (const line of timeline.lines.slice(0, -1)) {
        const bubble = timeline.bubbles.find((item) => item.index === line.index);
        assert.ok(bubble, `line ${line.index} has a card`);
        const lead = line.speechStartMs - bubble.startMs;
        const tail = bubble.endMs - line.speechEndMs;
        assert.ok(lead >= 200 && lead <= 600, `line ${line.index} card leads the voice (${lead} ms)`);
        assert.ok(tail >= 100 && tail <= 400, `line ${line.index} card holds after the voice (${tail} ms)`);
        assert.ok(bubble.startMs >= previousEnd, `line ${line.index} card does not overlap the previous card`);
        previousEnd = bubble.endMs;
    }
    assert.ok(timeline.fin.startMs >= previousEnd, 'the outro card opens after the last bubble closes');
    assert.ok(timeline.fin.endMs === timeline.durationMs);

    // The generated deck carries exactly those seconds.
    const deckFile = path.join(ROOT, detail.source.file);
    const deck = fs.readFileSync(deckFile, 'utf8');
    assert.equal(Number(deck.match(/data-d="(\d+)"/)[1]), timeline.durationMs);
    const sc = [...deck.matchAll(/class="t sc" data-s="([\d.]+)" data-e="([\d.]+)" data-w="[01]"/g)]
        .map((match) => ({ start: Math.round(Number(match[1]) * 1000), end: Math.round(Number(match[2]) * 1000) }));
    assert.equal(sc.length, timeline.bubbles.length);
    sc.forEach((bubble, i) => {
        assert.ok(Math.abs(bubble.start - timeline.bubbles[i].startMs) <= 2, `deck card ${i + 1} start`);
        assert.ok(Math.abs(bubble.end - timeline.bubbles[i].endMs) <= 2, `deck card ${i + 1} end`);
    });
    const finStart = Math.round(Number(deck.match(/class="t fin" data-s="([\d.]+)"/)[1]) * 1000);
    assert.ok(Math.abs(finStart - timeline.fin.startMs) <= 2);

    // The recording and the mix are the same length, and the recording has audio.
    const videoMs = Math.round(Number(probe(path.join(LIB, 'sources', `${design.id}.webm`)).format.duration) * 1000);
    const mixMs = Math.round(Number(probe(path.join(ROOT, design.audio)).format.duration) * 1000);
    assert.ok(Math.abs(videoMs - design.duration) <= 200, 'recording duration matches the timeline');
    assert.ok(Math.abs(mixMs - design.duration) <= 200, 'mix duration matches the timeline');
    const streams = probe(path.join(LIB, 'sources', `${design.id}.webm`)).streams;
    assert.ok(streams.some((stream) => stream.codec_type === 'audio'), 'the recording carries the narration');
    const picture = streams.find((stream) => stream.codec_type === 'video');
    assert.equal(picture.width, timeline.width);
    assert.equal(picture.height, timeline.height);

    // The library entry points at a real poster and a real recording.
    for (const suffix of ['.webm', '.jpg']) {
        assert.ok(fs.statSync(path.join(LIB, 'sources', `${design.id}${suffix}`)).size > 1000);
    }
    assert.equal(entry.sourceVideo, `/data/library/sources/${design.id}.webm`);
    assert.equal(entry.sourcePoster, `/data/library/sources/${design.id}.jpg`);
    assert.equal(detail.sourceVideo, entry.sourceVideo);
    assert.equal(detail.sourcePoster, entry.sourcePoster);
    assert.equal(entry.status, 'ready');
    assert.equal(entry.animations[0].origin, 'original');

    // A shift in any line must be visible in the detail the UI reads.
    assert.equal(detail.narration.lineCount, timeline.lines.length);
    timeline.lines.forEach((line, i) => {
        assert.equal(detail.narration.lines[i].speechStartMs, line.speechStartMs);
        assert.equal(detail.narration.lines[i].cardEndMs, line.bubble.endMs);
    });
});

test('the narrated cut is also an animation on the design it was cut from', { skip: !hasCut }, () => {
    const detail = JSON.parse(fs.readFileSync(
        path.join(LIB, 'designs', 'butterfly-the-pig---cinematic-03.json'), 'utf8'));
    const index = JSON.parse(fs.readFileSync(path.join(LIB, 'index.json'), 'utf8'));
    const entry = index.designs.find((item) => item.id === 'butterfly-the-pig---cinematic-03');
    const animationId = 'butterfly-the-pig---cinematic-03-narrated';
    const animation = (detail.animations || []).find((item) => item.id === animationId);
    assert.ok(animation, 'the source design has the narrated animation');
    assert.equal(animation.origin, 'narrated');
    assert.equal(animation.duration, 35720);
    assert.equal(animation.sourceVideo, `/data/library/sources/${animationId}.webm`);
    assert.equal(animation.narration.indexKey, animationId);

    const file = path.join(LIB, 'animations', 'butterfly-the-pig---cinematic-03', 'narrated.animation.json');
    assert.ok(fs.existsSync(file), 'the animation file exists');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(data.origin, 'narrated');
    assert.equal(data.duration, 35720);
    assert.equal(data.narration.indexKey, animationId);
    const compositionPath = path.join(ROOT, detail.composition.replace(/^\//, ''));
    const composition = JSON.parse(fs.readFileSync(compositionPath, 'utf8'));
    assert.ok(composition.layers.some((layer) => layer.id === data.tracks[0].layerId),
        'the animation track points at a real layer of the source composition');

    const listed = (entry.animations || []).find((item) => item.id === animationId);
    assert.ok(listed, 'the catalogue lists the narrated animation');
    assert.equal(listed.name, 'Narrated cut');
    assert.equal(listed.origin, 'narrated');
    assert.equal(listed.sourceVideo, animation.sourceVideo);
    assert.equal(listed.narration.indexKey, animationId);

    // The audio bed is editable live; its shape is the contract, not one
    // particular level or track.
    const mix = detail.audioMixes?.[animationId];
    assert.ok(mix, 'the source design has an audio mix for the narrated animation');
    assert.ok(mix.narration.volume >= 0 && mix.narration.volume <= 1);
    assert.equal(typeof mix.narration.muted, 'boolean');
    assert.equal(typeof mix.music.enabled, 'boolean');
    assert.ok(mix.music.volume >= 0 && mix.music.volume <= 1);
    assert.ok(mix.music.startMs >= 0);
    assert.ok(mix.music.endMs >= mix.music.startMs);
    assert.ok(Number.isFinite(mix.music.endMs));

    // Any enabled music must point inside the served audio folder.
    for (const item of Object.values(detail.audioMixes || {})) {
        if (item?.music?.enabled) {
            assert.match(item.music.url, /^\/data\/library\/audio\//);
        }
    }
});
