'use strict';

/**
 * Contract tests for the project canvas: the manifest derived from a real
 * project, the working-variant timeline editor, the server project reader and
 * the agent turn (with a fake model), plus the page wiring.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const Manifest = require('../src/shared/project-manifest.js');
const Timeline = require('../src/shared/project-timeline.js');
const ProjectCanvas = require('../src/server/project-canvas.js');
const server = require('../server.js');

const ROOT = path.join(__dirname, '..');
const PROJECT_ID = '06----giovannin-senza-paura-reels-03';
const COMPOSITION_FILE = path.join(ROOT, 'data', 'projects', PROJECT_ID, 'compositions', `${PROJECT_ID}.composition.json`);
const HAS_PROJECT = fs.existsSync(COMPOSITION_FILE);

const readComposition = () => JSON.parse(fs.readFileSync(COMPOSITION_FILE, 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

function loadManifest() {
    const composition = readComposition();
    return { composition, manifest: Manifest.build(composition) };
}

test('the manifest describes a real project from its own files', { skip: !HAS_PROJECT && 'the reference project is not on disk' }, () => {
    const { composition, manifest } = loadManifest();
    assert.equal(manifest.id, PROJECT_ID);
    assert.deepEqual(manifest.canvas, { w: 1080, h: 1920 });
    assert.equal(manifest.durationMs, 10000);
    assert.equal(manifest.entities.length, composition.layers.length);
    assert.equal(manifest.parents.length, 4);
    assert.equal(manifest.groups.length, 8);
    assert.equal(manifest.entities.filter((entity) => entity.text).length, 19);
    assert.equal(manifest.entities.filter((entity) => entity.segmented).length, 34);
    assert.equal(manifest.entities.filter((entity) => entity.type === 'image' && !entity.segmented).length, 2);
    assert.equal(manifest.textBasis, 'width');
    assert.ok(manifest.events.length > 40, 'the original animation is described');
    assert.ok(manifest.notes.some((note) => /inherit their parent image keyframes/.test(note)));
    assert.ok(manifest.notes.some((note) => /No video or sprite frames/.test(note)));
    assert.ok(manifest.notes.some((note) => /background parts? sit above/.test(note)));

    const character = manifest.groups.find((group) => /Character/.test(group.label));
    assert.equal(character.members.length, 13);
    assert.ok(character.live[0][0] === 0 && character.live[0][1] > 0);
    assert.ok(character.box.w > 0 && character.box.h > 0);

    const summary = Manifest.summary(manifest);
    assert.equal(summary.layers, composition.layers.length);
    assert.equal(summary.sources, 4);
    assert.equal(summary.texts, 19);
});

test('the agent context is compact, project-specific and selection-aware', { skip: !HAS_PROJECT && 'the reference project is not on disk' }, () => {
    const { composition, manifest } = loadManifest();
    const context = Manifest.context(manifest);
    assert.ok(context.includes(manifest.name));
    assert.ok(context.includes('IMAGE SOURCES:'));
    assert.ok(context.includes('SEMANTIC GROUPS'));
    assert.ok(context.includes('EVENTS (original animation)'));
    assert.ok(context.includes('TEXT SIZING'));
    assert.ok(context.length > 2000 && context.length < 20000, `context is ${context.length} chars`);
    assert.ok(context.length < JSON.stringify(composition).length / 10, 'context is far smaller than the composition');

    const selected = Manifest.context(manifest, {
        selection: ['m04-photo-t-pby-sp-on--group-character'],
        mode: 'blank',
    });
    assert.match(selected, /mode: blank/);
    assert.match(selected, /EVENTS \(cleared/);
    assert.match(selected, /USER SELECTION: group:Photo \(m04\) \/ Character\[13\]/);
});

test('selection ids expand from parts, groups and image sources', { skip: !HAS_PROJECT && 'the reference project is not on disk' }, () => {
    const { manifest } = loadManifest();
    const part = Manifest.resolve(manifest, ['m04-photo-t-pby-sp-on--seg-layer-character-blue-shirt']);
    assert.equal(part[0].kind, 'part');
    assert.equal(part[0].label, 'Blue Shirt');
    const group = Manifest.resolve(manifest, ['m04-photo-t-pby-sp-on--group-character']);
    assert.equal(group[0].kind, 'group');
    assert.equal(group[0].ids.length, 13);
    const image = Manifest.resolve(manifest, ['m04-photo-t-pby-sp-on']);
    assert.equal(image[0].kind, 'image');
    assert.equal(image[0].ids.length, 15);
    assert.deepEqual(Manifest.resolve(manifest, ['not-a-real-id']), []);
});

test('the query side answers without the full composition', { skip: !HAS_PROJECT && 'the reference project is not on disk' }, () => {
    const { composition, manifest } = loadManifest();
    const hits = Manifest.find(manifest, 'hot chocolate price', 3);
    assert.ok(hits.length > 0);
    assert.ok(hits.some((hit) => /HOT CHOCOLATE/i.test(hit.label)));
    const shirt = Manifest.find(manifest, 'blue top', 4);
    assert.ok(shirt.some((hit) => /Blue Shirt/.test(hit.label)), 'the shirt is among the candidates');

    const at = Manifest.at(manifest, 8000);
    assert.ok(at.some((entry) => /m17-text-luxury-hot-chocolate/.test(entry.id)));
    assert.ok(!at.some((entry) => /blue-shirt/.test(entry.id)), 'the character has left by 8s');

    const frames = Manifest.keyframes(composition, 'm02-text-1up');
    assert.ok(Array.isArray(frames) && frames.length >= 2);
    assert.deepEqual(Manifest.keyframes(composition, 'nope'), []);
});

test('start modes keep the master composition untouched', { skip: !HAS_PROJECT && 'the reference project is not on disk' }, () => {
    const composition = readComposition();
    const snapshot = JSON.stringify(composition);
    const original = Manifest.start(composition, 'original');
    assert.equal(original.id, `${composition.id}--original`);
    assert.equal(JSON.stringify(composition), snapshot, 'the master was not edited');
    assert.deepEqual(original.layers.map((layer) => layer.keyframes.length), composition.layers.map((layer) => layer.keyframes.length));

    const blank = Manifest.start(composition, 'blank');
    assert.equal(blank.id, `${composition.id}--blank`);
    assert.ok(blank.layers.every((layer) => layer.keyframes.length === 1), 'blank keeps one static pose per layer');
    assert.ok(blank.layers.every((layer) => layer.keyframes[0].opacity === 1));
    assert.equal(JSON.stringify(composition), snapshot, 'blank did not edit the master either');
});

test('a relative group edit composes on top of the existing animation', { skip: !HAS_PROJECT && 'the reference project is not on disk' }, () => {
    const composition = clone(readComposition());
    const manifest = Manifest.build(composition);
    const groupId = 'm04-photo-t-pby-sp-on--group-character';
    const members = manifest.groups.find((group) => group.id === groupId).members;
    const shirt = composition.layers.find((layer) => /blue-shirt/.test(layer.id));
    const before = members.map((id) => Timeline.pose(composition.layers.find((layer) => layer.id === id), 0));
    const originalKeyframes = shirt.keyframes.map((frame) => frame.time);
    const originalJump = Timeline.pose(shirt, 7399).y;

    const result = Timeline.applyEdits(composition, manifest, [{
        ids: [groupId],
        relative: true,
        keyframes: [{ time: 0, dx: 0 }, { time: 2000, dx: 30 }, { time: 4000, dx: 60 }],
    }]);

    assert.equal(result.edits, 1);
    assert.equal(result.summary[0], '13 layers');
    assert.equal(result.earliest, 0);
    const times = new Set(shirt.keyframes.map((frame) => frame.time));
    for (const time of originalKeyframes) assert.ok(times.has(time), `keyframe ${time}ms is kept`);
    assert.ok(Math.abs(Timeline.pose(shirt, 7399).y - originalJump) < 0.001, 'the original exit jump is untouched');

    const start = Timeline.pose(shirt, 0).x;
    const middle = Timeline.pose(shirt, 2000).x;
    const end = Timeline.pose(shirt, 4000).x;
    assert.ok(Math.abs(start - before[members.indexOf(shirt.id)].x) < 0.01, 'time 0 is unchanged');
    assert.ok(Math.abs((middle - start) - 30) < 0.05, `moved ${middle - start}% by 2s`);
    assert.ok(Math.abs((end - start) - 60) < 0.05, `moved ${end - start}% by 4s`);

    // Every member moved together.
    for (const id of members) {
        const layer = composition.layers.find((entry) => entry.id === id);
        const moved = Timeline.pose(layer, 4000).x - Timeline.pose(layer, 0).x;
        assert.ok(Math.abs(moved - 60) < 0.05, `${id} moved ${moved}%`);
    }

    // Existing opacity changes survive the edit.
    const exit = Timeline.pose(shirt, 7400).opacity;
    assert.ok(exit < 1, 'the original exit still fades the character out');
});

test('a pivot edit orbits a limb while the walk stays underneath', { skip: !HAS_PROJECT && 'the reference project is not on disk' }, () => {
    const composition = clone(readComposition());
    const manifest = Manifest.build(composition);
    const groupId = 'm04-photo-t-pby-sp-on--group-character';
    Timeline.applyEdits(composition, manifest, [{
        ids: [groupId],
        keyframes: [{ time: 0, dx: 0 }, { time: 4000, dx: 60 }],
    }]);
    const leg = composition.layers.find((layer) => /left-leg/.test(layer.id));
    const walkedX = Timeline.pose(leg, 4000).x;
    const hip = Timeline.pose(leg, 2000);

    Timeline.applyEdits(composition, manifest, [{
        ids: [leg.id],
        pivot: { x: hip.x + hip.w / 2, y: hip.y },
        keyframes: [
            { time: 0, rotation: 0 },
            { time: 500, rotation: 25 },
            { time: 1000, rotation: -25 },
            { time: 2000, rotation: 0 },
        ],
    }]);

    assert.ok(leg.keyframes.length > 4);
    assert.ok(Math.abs(Timeline.pose(leg, 500).rotation - 25) < 0.01);
    assert.ok(Math.abs(Timeline.pose(leg, 1000).rotation + 25) < 0.01);
    assert.ok(Math.abs(Timeline.pose(leg, 4000).x - walkedX) < 0.01, 'the walk is preserved at 4s');
});

test('absolute edits set a pose and keep unspecified fields', { skip: !HAS_PROJECT && 'the reference project is not on disk' }, () => {
    const composition = clone(readComposition());
    const manifest = Manifest.build(composition);
    const text = composition.layers.find((layer) => layer.id === 'm02-text-1up');
    const group = composition.layers.find((layer) => layer.id === 'm04-photo-t-pby-sp-on--seg-layer-character-blue-shirt');

    Timeline.applyEdits(composition, manifest, [{
        ids: [text.id],
        relative: false,
        keyframes: [{ time: 1000, x: 20, opacity: 0.5 }],
    }]);
    const pose = Timeline.pose(text, 1000);
    assert.equal(pose.x, 20);
    assert.equal(pose.opacity, 0.5);
    assert.equal(pose.y, text.y, 'y was not mentioned, so it keeps its value');

    const untouched = Timeline.pose(group, 1000);
    const original = Timeline.pose(group, 1000);
    assert.equal(untouched.x, original.x);
});

test('generated layers are inline SVG and unsafe markup is rejected', () => {
    const composition = clone(readComposition());
    const layer = Timeline.addGeneratedLayer(composition, {
        name: 'ghost',
        svg: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#fff"/></svg>',
        x: 60, y: 50, w: 20, h: 15, z: 80,
        keyframes: [{ time: 500, opacity: 0 }, { time: 1500, opacity: 1 }],
    });
    assert.match(layer.id, /^gen-/);
    assert.equal(layer.generated, true);
    assert.equal(layer.meta.generated, true);
    assert.match(layer.url, /^data:image\/svg\+xml;utf8,/);
    assert.match(decodeURIComponent(layer.url), /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.equal(layer.keyframes.length, 2);
    assert.ok(composition.layers.includes(layer));

    assert.throws(() => Timeline.addGeneratedLayer(composition, {
        name: 'bad', svg: '<svg><script>alert(1)</script></svg>', x: 0, y: 0, w: 10, h: 10,
    }), /must not contain scripts/);
    assert.throws(() => Timeline.addGeneratedLayer(composition, {
        name: 'bad', svg: '<svg onload="alert(1)"><rect/></svg>', x: 0, y: 0, w: 10, h: 10,
    }), /must not contain scripts/);
    assert.throws(() => Timeline.addGeneratedLayer(composition, {
        name: 'bad', svg: 'not an svg', x: 0, y: 0, w: 10, h: 10,
    }), /complete inline <svg>/);

    const tiny = Timeline.addGeneratedLayer(composition, {
        name: 'dot', svg: '<svg><rect width="1" height="1"/></svg>', x: 10, y: 10, w: 0, h: -5,
    });
    assert.equal(tiny.w, 0.2);
    assert.equal(tiny.h, 0.2);
});

test('the server reads the real project and rejects unsafe ids', { skip: !HAS_PROJECT && 'the reference project is not on disk' }, async () => {
    const loaded = await ProjectCanvas.readProject(PROJECT_ID);
    assert.equal(loaded.project.id, PROJECT_ID);
    assert.equal(loaded.project.compositionId, PROJECT_ID);
    assert.equal(loaded.project.width, 1080);
    assert.equal(loaded.project.height, 1920);
    assert.equal(loaded.project.layerCount, 55);
    assert.equal(loaded.project.segmented, true);
    assert.equal(loaded.composition.layers.length, 55);
    assert.ok(loaded.index && Array.isArray(loaded.index.groups));
    assert.equal(loaded.manifest.groups.length, 8);

    await assert.rejects(ProjectCanvas.readProject('../../etc'), /invalid/);
    await assert.rejects(ProjectCanvas.readProject('no-such-project-xyz'), /compositions/);
    await assert.rejects(ProjectCanvas.readProject(PROJECT_ID, 'no-such-composition'), /no composition/);

    const list = await ProjectCanvas.listProjects();
    assert.ok(Array.isArray(list.projects));
    assert.ok(list.projects.length > 0);
    const entry = list.projects.find((project) => project.id === PROJECT_ID);
    assert.equal(entry.name, loaded.project.name);
    assert.equal(entry.width, 1080);
    assert.equal(entry.segmented, true);
    assert.deepEqual(entry.compositions, [PROJECT_ID]);
});

test('a model reply is validated, clamped and stripped of unknown ids', { skip: !HAS_PROJECT && 'the reference project is not on disk' }, async () => {
    const { manifest, composition } = await ProjectCanvas.readProject(PROJECT_ID);
    const turn = ProjectCanvas.normaliseTurn({
        reply: '  Move and pop.  ',
        beats: ['walk right', 'pop the price', ''],
        edits: [
            {
                ids: ['m04-photo-t-pby-sp-on--group-character'],
                keyframes: [{ time: -500, dx: 0 }, { time: 999999, dx: 10, nonsense: 3 }],
            },
            { ids: ['not-a-real-id'], keyframes: [{ time: 0, dx: 10 }] },
            {
                ids: ['m13-photo-t-sp-me-on'],
                relative: false,
                keyframes: [{ time: 1000, x: 5, y: 6, w: 7, h: 8 }],
            },
            { ids: ['m02-text-1up'], keyframes: [{ time: 0 }] },
        ],
        layers: [
            { name: 'ghost', svg: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>', x: 50, y: 50, w: 10, h: 10 },
            { name: 'bad', svg: '<svg onload="x()"><rect/></svg>', x: 1, y: 1, w: 1, h: 1 },
        ],
    }, { manifest, composition });

    assert.equal(turn.reply, 'Move and pop.');
    assert.deepEqual(turn.beats, ['walk right', 'pop the price']);
    assert.equal(turn.edits.length, 2);
    assert.equal(turn.edits[0].relative, true);
    assert.equal(turn.edits[0].ids.length, 13);
    assert.equal(turn.edits[0].keyframes[0].time, 0, 'a negative time is clamped');
    assert.equal(turn.edits[0].keyframes[1].time, composition.duration, 'a late time is clamped');
    assert.equal(turn.edits[0].keyframes[1].nonsense, undefined);
    assert.ok(turn.edits[0].labels.includes('Blue Shirt'));
    assert.equal(turn.edits[1].relative, false);
    assert.deepEqual(turn.edits[1].ids, ['m13-photo-t-sp-me-on']);
    assert.equal(turn.layers.length, 1);
    assert.equal(turn.layers[0].name, 'ghost');
    assert.match(turn.layers[0].svg, /xmlns=/);
    assert.ok(turn.warnings.some((warning) => /ignored/.test(warning)));
});

test('one agent turn runs a query round and returns usable edits', { skip: !HAS_PROJECT && 'the reference project is not on disk' }, async () => {
    const calls = [];
    const generate = async ({ messages, phase }) => {
        calls.push({ phase, messages });
        if (calls.length === 1) {
            return JSON.stringify({
                queries: [
                    { tool: 'find_elements', query: 'blue top' },
                    { tool: 'visible_at', ms: 8000 },
                ],
            });
        }
        return JSON.stringify({
            reply: 'The character walks right, then stops.',
            beats: ['walk right over 2s', 'hold'],
            edits: [{
                ids: ['m04-photo-t-pby-sp-on--group-character'],
                keyframes: [{ time: 0, dx: 0 }, { time: 2000, dx: 20 }],
            }],
        });
    };
    const result = await ProjectCanvas.agentTurn({
        projectId: PROJECT_ID,
        mode: 'original',
        selection: ['m04-photo-t-pby-sp-on--group-character'],
        messages: [{ role: 'user', content: 'the man walks a bit to the right' }],
    }, {
        resolveModel: async () => ({ provider: 'test', model: 'fake' }),
        generate,
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].phase, 'plan');
    assert.equal(calls[1].phase, 'answer');
    assert.match(calls[0].messages[0].content, /USER SELECTION: group:Photo \(m04\) \/ Character\[13\]/);
    assert.match(calls[1].messages.at(-1).content, /QUERY RESULTS/);
    assert.match(calls[1].messages.at(-1).content, /Blue Shirt/);
    assert.equal(result.ok, true);
    assert.equal(result.provider, 'test');
    assert.equal(result.project, '06 --   Giovannin Senza Paura · reels — 03');
    assert.deepEqual(result.selection, ['m04-photo-t-pby-sp-on--group-character']);
    assert.equal(result.queries.length, 2);
    assert.equal(result.queries[0].tool, 'find_elements');
    assert.ok(result.queries[0].count > 0);
    assert.ok(result.queries[1].count > 0);
    assert.equal(result.edits.length, 1);
    assert.equal(result.edits[0].ids.length, 13);
    assert.equal(result.reply, 'The character walks right, then stops.');
});

test('the agent reports a non-JSON model reply instead of applying it', { skip: !HAS_PROJECT && 'the reference project is not on disk' }, async () => {
    const result = await ProjectCanvas.agentTurn({
        projectId: PROJECT_ID,
        messages: [{ role: 'user', content: 'hello' }],
    }, {
        resolveModel: async () => ({ provider: 'test', model: 'fake' }),
        generate: async () => 'I would rather just talk about it.',
    });
    assert.equal(result.edits.length, 0);
    assert.equal(result.layers.length, 0);
    assert.match(result.reply, /talk about it/);
    assert.ok(result.warnings.some((warning) => /not valid JSON/.test(warning)));
});

test('the agent turn refuses to run without a transport or messages', async () => {
    await assert.rejects(ProjectCanvas.agentTurn({ projectId: PROJECT_ID }, {}), /no model transport/);
    assert.throws(() => ProjectCanvas.sanitiseMessages([]), /Ask the agent/);
    assert.throws(() => ProjectCanvas.sanitiseMessages([{ role: 'user', content: '   ' }]), /Ask the agent/);
    const messages = ProjectCanvas.sanitiseMessages([
        { role: 'system', content: 'ignored' },
        { role: 'assistant', content: ' hello ' },
        { role: 'user', content: 'world' },
    ]);
    assert.deepEqual(messages.map((message) => message.role), ['assistant', 'user']);
    assert.equal(messages[0].content, 'hello');
});

test('an uploaded image becomes a real layer the agent can animate', { skip: !HAS_PROJECT && 'the reference project is not on disk' }, () => {
    const composition = clone(readComposition());
    const manifest = Manifest.build(composition);
    const layer = Timeline.addImageLayer(composition, {
        name: 'my photo',
        url: 'data:image/png;base64,AAAA',
        x: 20, y: 20, w: 30, h: 20, z: 60,
    });
    assert.match(layer.id, /^gen-/);
    assert.equal(layer.uploaded, true);
    assert.equal(layer.name, 'my photo');
    assert.equal(layer.keyframes.length, 1);
    assert.deepEqual(Timeline.resolveLayers(manifest, [layer.id], composition), [layer.id]);

    const result = Timeline.applyEdits(composition, manifest, [{
        ids: [layer.id],
        keyframes: [{ time: 0, dx: 0 }, { time: 2000, dx: 15 }],
    }]);
    assert.equal(result.summary[0], '1 layer');
    assert.ok(Math.abs(Timeline.pose(layer, 2000).x - 35) < 0.01, 'the uploaded layer followed the edit');

    assert.throws(() => Timeline.addImageLayer(composition, {
        name: 'remote', url: 'https://example.com/photo.png', x: 0, y: 0, w: 10, h: 10,
    }), /local file/);
});

test('the server accepts variant layers and drawn annotations', { skip: !HAS_PROJECT && 'the reference project is not on disk' }, async () => {
    const { composition, manifest } = await ProjectCanvas.readProject(PROJECT_ID);
    const variant = ProjectCanvas.sanitiseVariant({
        layers: [{ id: 'gen-up-test', name: ' my photo ', kind: 'uploaded', x: 30, y: 40, w: 20, h: 10, z: 60 }],
        annotations: {
            strokes: [{ points: [[20, 50], [30, 50], [40, 50], [50, 50], [60, 50]] }],
            from: 1000,
            to: 4000,
        },
    }, composition);
    assert.equal(variant.layers.length, 1);
    assert.equal(variant.layers[0].name, 'my photo');
    assert.equal(variant.layers[0].kind, 'uploaded');
    assert.equal(variant.strokes.length, 1);
    assert.deepEqual(variant.window, { from: 1000, to: 4000 });

    const character = 'm04-photo-t-pby-sp-on--group-character';
    const plan = ProjectCanvas.annotationPlan(manifest, composition, variant, [character], 'original');
    assert.ok(plan);
    assert.equal(plan.keyframes[0].time, 1000);
    assert.equal(plan.keyframes[0].dx, 0);
    assert.equal(plan.keyframes[0].dy, 0);
    const last = plan.keyframes[plan.keyframes.length - 1];
    assert.equal(last.time, 4000);
    assert.ok(Math.abs(last.dx - 40) < 0.01, `the route displacement was converted (dx ${last.dx})`);
    assert.ok(Math.abs(last.dy) < 0.01);

    const text = ProjectCanvas.describeVariant(variant, manifest, composition, [character, 'gen-up-test'], 'original');
    assert.match(text, /CLIENT VARIANT/);
    assert.match(text, /gen-up-test "my photo"/);
    assert.match(text, /USER ANNOTATIONS/);
    assert.match(text, /SUGGESTED PATH KEYFRAMES/);
    assert.match(text, /USER SELECTION \(client variant\): gen-up-test/);

    const turn = ProjectCanvas.normaliseTurn({
        reply: 'ok',
        edits: [
            { ids: ['gen-up-test'], keyframes: [{ time: 0, dx: 0 }, { time: 1000, dx: 5 }] },
            { ids: [character], keyframes: [{ time: 0, dx: 0 }, { time: 1000, dx: 2 }] },
        ],
    }, { manifest, composition, variant });
    assert.equal(turn.edits.length, 2);
    assert.deepEqual(turn.edits[0].ids, ['gen-up-test']);
    assert.deepEqual(turn.edits[0].labels, ['my photo']);
    assert.equal(turn.edits[1].ids.length, 13);
    assert.deepEqual(turn.warnings, []);
});

test('one agent turn carries the drawings and variant layers in its context', { skip: !HAS_PROJECT && 'the reference project is not on disk' }, async () => {
    let system = '';
    const result = await ProjectCanvas.agentTurn({
        projectId: PROJECT_ID,
        mode: 'original',
        selection: ['gen-up-test'],
        variant: {
            layers: [{ id: 'gen-up-test', name: 'my photo', kind: 'uploaded', x: 30, y: 40, w: 20, h: 10, z: 60 }],
            annotations: {
                strokes: [{ points: [[20, 50], [30, 50], [40, 50], [50, 50], [60, 50]] }],
                from: 500,
                to: 2500,
            },
        },
        messages: [{ role: 'user', content: 'follow the drawing' }],
    }, {
        resolveModel: async () => ({ provider: 'test', model: 'fake' }),
        generate: async ({ messages }) => {
            system = messages[0].content;
            return JSON.stringify({
                reply: 'Followed the drawing.',
                edits: [{ ids: ['gen-up-test'], keyframes: [{ time: 0, dx: 0 }, { time: 2000, dx: 10 }] }],
            });
        },
    });
    assert.match(system, /CLIENT VARIANT/);
    assert.match(system, /USER ANNOTATIONS/);
    assert.match(system, /SUGGESTED PATH KEYFRAMES/);
    assert.match(system, /Annotation window: 0\.5s→2\.5s/);
    assert.equal(result.selection.length, 1);
    assert.equal(result.selection[0], 'gen-up-test');
    assert.equal(result.edits.length, 1);
    assert.deepEqual(result.edits[0].ids, ['gen-up-test']);
});

test('the page wires the drawing canvas, uploaded images and the variant payload', () => {
    const page = fs.readFileSync(path.join(ROOT, 'pages', 'project-canvas.html'), 'utf8');
    assert.match(page, /id="annotations"/);
    assert.match(page, /id="annotateBtn"/);
    assert.match(page, /id="addImageBtn"/);
    assert.match(page, /id="imageInput"/);
    assert.match(page, /id="variantSection"/);
    assert.match(page, /id="windowFrom"/);

    const client = fs.readFileSync(path.join(ROOT, 'src', 'client', 'project-canvas', 'project-canvas.js'), 'utf8');
    assert.match(client, /Timeline\.addImageLayer/);
    assert.match(client, /variant\.annotations/);
    assert.match(client, /annotations\.addEventListener\('pointerdown'/);
});

test('the page route and its assets are wired in the right places', () => {
    assert.equal(server.PAGE_ROUTES['/project-canvas'], 'project-canvas.html');
    assert.equal(server.PAGE_ROUTES['/project-canvas/'], 'project-canvas.html');
    assert.equal(server.PAGE_ROUTES['/project-canvas.html'], 'project-canvas.html');
    assert.equal(server.ProjectCanvas, ProjectCanvas);

    const page = fs.readFileSync(path.join(ROOT, 'pages', 'project-canvas.html'), 'utf8');
    assert.match(page, /\/src\/shared\/project-manifest\.js/);
    assert.match(page, /\/src\/shared\/project-timeline\.js/);
    assert.match(page, /\/src\/client\/project-canvas\/project-canvas\.js/);
    assert.match(page, /\/src\/client\/project-canvas\/project-canvas\.css/);
    assert.match(page, /id="stage"/);
    assert.match(page, /id="chatForm"/);

    const client = fs.readFileSync(path.join(ROOT, 'src', 'client', 'project-canvas', 'project-canvas.js'), 'utf8');
    assert.match(client, /\/api\/project-canvas\/agent/);
    assert.match(client, /Timeline\.applyEdits/);
    assert.match(client, /Timeline\.addGeneratedLayer/);

    const admin = fs.readFileSync(path.join(ROOT, 'pages', 'admin.html'), 'utf8');
    assert.match(admin, /href="\/project-canvas"/);
    const segments = fs.readFileSync(path.join(ROOT, 'pages', 'segments.html'), 'utf8');
    assert.match(segments, /href="\/project-canvas"/);
    assert.ok(fs.existsSync(path.join(ROOT, 'docs', 'project-canvas.md')));
});

test('the project canvas prefers the editable composition and its native canvas', async () => {
    const id = 'borders-web-where-i-work-cinematic-minimal-03';
    const editableFile = path.join(ROOT, 'data', 'projects', id, 'compositions', `${id}.editable.json`);
    if (!fs.existsSync(editableFile)) return;
    const { projects } = await ProjectCanvas.listProjects();
    const entry = projects.find((project) => project.id === id);
    assert.ok(entry);
    assert.equal(entry.compositionId, `${id}.editable`);
    assert.ok(entry.compositions.includes(`${id}.editable`));
    assert.equal(entry.width, 928);
    assert.equal(entry.height, 1143);
    assert.equal(entry.duration, 13000);

    const opened = await ProjectCanvas.readProject(id);
    assert.equal(opened.project.compositionId, `${id}.editable`);
    assert.equal(opened.composition.width, 928);
    assert.equal(opened.composition.height, 1143);
    assert.equal(opened.composition.duration, 13000);
    assert.ok(opened.composition.layers.length >= 12);
    assert.match(opened.composition.name, /Woven Linen/);

    const client = fs.readFileSync(path.join(ROOT, 'src', 'client', 'project-canvas', 'project-canvas.js'), 'utf8');
    assert.match(client, /Editable layers/);
});

test('the studio project catalogue offers the editable composition', async () => {
    const id = 'repo-borders-web-where-i-work-cinematic-minimal-03';
    const projects = await server.listStudioProjects();
    const project = projects.find((entry) => entry.id === id);
    if (!project) return;
    const composition = (project.compositions || []).find((entry) => entry.id === 'borders-web-where-i-work-cinematic-minimal-03');
    assert.ok(composition);
    assert.equal(composition.editable, true);
    assert.ok(composition.layerCount >= 12);
    assert.equal(composition.width, 928);
    assert.equal(composition.height, 1143);
    assert.equal(composition.duration, 13000);
});
