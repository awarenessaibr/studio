'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX_FILE = path.join(ROOT, 'data/library/narrations/index.json');
const hasIndex = fs.existsSync(INDEX_FILE);
const readJson = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));

test('every narration in the index has cast direction for each speaker', {
    skip: hasIndex ? false : 'the narration index has not been generated',
}, () => {
    const index = readJson('data/library/narrations/index.json');
    assert.equal(index.schema, 'studio/narration-index/1');
    const entries = Object.entries(index.narrations || {});
    assert.ok(entries.length, 'the narration index has at least one entry');

    for (const [designId, entry] of entries) {
        const timelineFile = entry.fallbackTimeline || entry.timeline;
        assert.ok(timelineFile, `${designId} points at a timeline`);
        const timeline = readJson(timelineFile);
        assert.equal(timeline.schema, 'studio/narration-timeline/1');
        assert.ok(Array.isArray(timeline.lines) && timeline.lines.length, `${designId} has spoken lines`);
        assert.ok(Number(timeline.durationMs) > 0, `${designId} has a duration`);
        assert.match(timeline.audio?.mix || '', /\S/, `${designId} has a mixed voice track`);

        const cast = new Map((entry.cast || []).map(member => [member.name, member]));
        const speakers = new Set(timeline.lines.map(line => line.speaker));
        for (const speaker of speakers) {
            const member = cast.get(speaker);
            assert.ok(member, `${designId} has direction for ${speaker}`);
            assert.match(member.role || '', /\S/, `${speaker} has a role`);
            assert.match(member.voice || '', /\S/, `${speaker} has a voice description`);
            assert.ok(Array.isArray(member.traits) && member.traits.length, `${speaker} has traits`);
        }
        for (const member of cast.values()) {
            assert.ok(member.kind, `${member.name} has a kind`);
        }
    }
});

test('the studio page exposes the cast panel and the white theme', () => {
    const page = fs.readFileSync(path.join(ROOT, 'pages/agent-first-studio.html'), 'utf8');
    assert.match(page, /id="tAudio"/);
    assert.match(page, /id="audio"/);
    assert.match(page, /NARRATION_INDEX/);
    assert.match(page, /:root\[data-theme=light\]/);
    assert.match(page, /--stage:/);
});
