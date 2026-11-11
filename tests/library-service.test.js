'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Library = require('../src/server/library-service.js');

async function fixture() {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-first-library-'));
    const libraryDir = path.join(root, 'library');
    const projectsDir = path.join(root, 'projects');
    const designId = 'test-design';
    const compositionDir = path.join(projectsDir, designId, 'compositions');
    await fsp.mkdir(compositionDir, { recursive: true });
    await fsp.mkdir(path.join(libraryDir, 'designs'), { recursive: true });
    await fsp.writeFile(path.join(libraryDir, 'index.json'), JSON.stringify({
        schema: 'agent-studio/library/1', designs: [{ id: designId, name: 'Test', status: 'ready', animations: [] }],
    }));
    await fsp.writeFile(path.join(libraryDir, 'clips.json'), JSON.stringify({
        schema: 'agent-studio/library/1', clips: [{
            id: 'clip-fade', name: 'Fade', duration: 600,
            frames: [{ t: 0, a: 0 }, { t: 600, a: 1 }],
        }],
    }));
    await fsp.writeFile(path.join(libraryDir, 'designs', `${designId}.json`), JSON.stringify({
        schema: 'agent-studio/library/1', id: designId, name: 'Test', project: designId,
        composition: `/data/projects/${designId}/compositions/${designId}.composition.json`,
        duration: 2000, animations: [],
        groups: [{ id: 'g-text', kind: 'card', label: 'Card', layerIds: ['headline'] }],
    }));
    const composition = {
        name: 'Test', width: 1080, height: 1080, duration: 2000,
        layers: [{ id: 'headline', type: 'text', name: 'Headline', x: 10, y: 10, w: 80, h: 20, text: 'Hello' }],
    };
    await fsp.writeFile(path.join(compositionDir, `${designId}.composition.json`), JSON.stringify(composition));
    return { root, libraryDir, projectsDir, designId, composition };
}

test('library service validates, normalises holds and composes clips', async () => {
    const f = await fixture();
    try {
        const hold = {
            name: 'Hold', duration: 1000, tracks: [{
                layerId: 'headline', segments: [{
                    start: 0, duration: 1000, frames: [{ t: 0, a: 1 }],
                }],
            }],
        };
        const normalised = Library.normaliseAnimation({ id: f.designId }, hold);
        assert.strictEqual(normalised.tracks[0].segments[0].frames.length, 2);
        assert.strictEqual(normalised.tracks[0].segments[0].frames[1].t, 1000);
        const validation = Library.validateAnimation({ id: f.designId }, f.composition, normalised);
        assert.strictEqual(validation.status, 'ok');

        const invalid = Library.validateAnimation({ id: f.designId }, f.composition, {
            tracks: [{ layerId: 'missing', segments: [] }],
        });
        assert.strictEqual(invalid.status, 'broken');

        const composed = await Library.composeAnimation({
            libraryDir: f.libraryDir, projectsDir: f.projectsDir, designId: f.designId,
            name: 'Composed', steps: [{ target: 'g-text', clip: 'clip-fade', start: 0, stagger: 0 }],
        });
        assert.strictEqual(composed.status, 'ok');
        assert.strictEqual(composed.animation.tracks.length, 1);
        assert.strictEqual(composed.animation.tracks[0].segments[0].frames.length, 2);
    } finally {
        await fsp.rm(f.root, { recursive: true, force: true });
    }
});

// A design may publish a rasterised poster and keep the layered extraction archived.
// Animations are authored against whichever composition existed when they were made,
// so validation has to follow the tracks rather than assume the canonical file.
async function posterFixture() {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-first-library-poster-'));
    const libraryDir = path.join(root, 'library');
    const projectsDir = path.join(root, 'projects');
    const designId = 'poster-design';
    const compositionDir = path.join(projectsDir, designId, 'compositions');
    await fsp.mkdir(compositionDir, { recursive: true });
    await fsp.mkdir(path.join(libraryDir, 'designs'), { recursive: true });
    await fsp.writeFile(path.join(libraryDir, 'index.json'), JSON.stringify({
        schema: 'agent-studio/library/1',
        designs: [{ id: designId, name: 'Poster', status: 'ready', animations: [] }],
    }));
    await fsp.writeFile(path.join(libraryDir, 'clips.json'), JSON.stringify({ schema: 'agent-studio/library/1', clips: [] }));
    await fsp.writeFile(path.join(libraryDir, 'designs', `${designId}.json`), JSON.stringify({
        schema: 'agent-studio/library/1', id: designId, name: 'Poster', project: designId,
        composition: `/data/projects/${designId}/compositions/${designId}.composition.json`,
        duration: 4000, animations: [],
    }));
    await fsp.writeFile(path.join(compositionDir, `${designId}.composition.json`), JSON.stringify({
        name: 'Poster', width: 1080, height: 1080, duration: 4000,
        meta: { exactPoster: true, editableArchive: `compositions/${designId}.editable.json` },
        layers: [{ id: 'source-frame', type: 'image', name: 'Source frame', x: 0, y: 0, w: 100, h: 100, z: 0 }],
    }));
    await fsp.writeFile(path.join(compositionDir, `${designId}.editable.json`), JSON.stringify({
        name: 'Poster (layered)', width: 1080, height: 1080, duration: 4000,
        layers: [
            { id: 'html-bg', type: 'image', name: 'Background', x: 0, y: 0, w: 100, h: 100, z: 0 },
            { id: 'm01-artwork', type: 'image', name: 'Artwork', x: 0, y: 0, w: 100, h: 100, z: 1 },
        ],
    }));
    return { root, libraryDir, projectsDir, designId };
}

test('library service validates against the composition an animation fits', async () => {
    const f = await posterFixture();
    try {
        const layered = {
            name: 'Ripples', duration: 4000,
            tracks: ['html-bg', 'm01-artwork'].map((layerId) => ({
                layerId, segments: [{ start: 0, duration: 4000, frames: [{ t: 0, a: 0 }, { t: 4000, a: 1 }] }],
            })),
        };
        const saved = await Library.saveAnimation({
            libraryDir: f.libraryDir, projectsDir: f.projectsDir, designId: f.designId, animation: layered,
        });
        assert.strictEqual(saved.ok, true);
        assert.strictEqual(saved.status, 'ok');
        assert.match(saved.composition, /\.editable\.json$/, 'should validate against the layered archive');

        // An animation written for the poster frame still resolves to the canonical file.
        const posterFrame = {
            name: 'Poster motion', duration: 4000,
            tracks: [{ layerId: 'source-frame', segments: [{ start: 0, duration: 4000, frames: [{ t: 0, a: 0 }, { t: 4000, a: 1 }] }] }],
        };
        const savedPoster = await Library.saveAnimation({
            libraryDir: f.libraryDir, projectsDir: f.projectsDir, designId: f.designId, animation: posterFrame,
        });
        assert.strictEqual(savedPoster.status, 'ok');
        assert.match(savedPoster.composition, /\.composition\.json$/, 'should fall back to the rasterised poster');

        // A track that exists in neither is still rejected.
        await assert.rejects(() => Library.saveAnimation({
            libraryDir: f.libraryDir, projectsDir: f.projectsDir, designId: f.designId,
            animation: { name: 'Nope', tracks: [{ layerId: 'invented-layer', segments: [{ start: 0, duration: 1000, frames: [{ t: 0 }, { t: 1000 }] }] }] },
        }), /is not in this design/);
    } finally {
        await fsp.rm(f.root, { recursive: true, force: true });
    }
});
