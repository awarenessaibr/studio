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
