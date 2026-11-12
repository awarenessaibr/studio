'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ReviewStore = require('../src/server/review-store.js');

const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reviews-')), 'reviews.json');

test('a mark is shared across surfaces by any of its ids', async () => {
    const file = tempFile();
    await ReviewStore.setMark(file, {
        ids: { designId: 'butterfly-the-pig-chase', compositionId: 'butterfly-the-pig-chase' },
        name: 'The Butterfly and the Pig · Chase',
        kind: 'design',
        surface: 'afs',
        status: 'works',
        note: 'plays at native size',
    });
    await ReviewStore.setMark(file, {
        ids: { compositionId: 'butterfly-the-pig-chase' },
        surface: 'project-canvas',
        status: 'review',
    });
    const state = await ReviewStore.readState(file);
    assert.equal(state.items.length, 1, 'the composition id matched the existing item');
    const item = state.items[0];
    assert.equal(item.ids.designId, 'butterfly-the-pig-chase');
    assert.equal(item.surfaces.afs.status, 'works');
    assert.equal(item.surfaces.afs.note, 'plays at native size');
    assert.equal(item.surfaces['project-canvas'].status, 'review');
});

test('clearing a surface mark keeps the item for the other surfaces', async () => {
    const file = tempFile();
    await ReviewStore.setMark(file, { ids: { compositionId: 'c1' }, surface: 'studio', status: 'broken' });
    await ReviewStore.setMark(file, { ids: { compositionId: 'c1' }, surface: 'afs', status: 'review' });
    const cleared = await ReviewStore.setMark(file, { ids: { compositionId: 'c1' }, surface: 'studio', status: 'unmarked' });
    assert.deepEqual(cleared.item.surfaces, { afs: { status: 'review', note: '', updatedAt: cleared.item.surfaces.afs.updatedAt } });
    const state = await ReviewStore.readState(file);
    assert.equal(state.items.length, 1);
});

test('validates surfaces, statuses and ids', async () => {
    const file = tempFile();
    await assert.rejects(
        () => ReviewStore.setMark(file, { ids: { compositionId: 'c1' }, surface: 'everywhere', status: 'works' }),
        /Unknown surface/,
    );
    await assert.rejects(
        () => ReviewStore.setMark(file, { ids: { compositionId: 'c1' }, surface: 'afs', status: 'maybe' }),
        /Unknown review status/,
    );
    await assert.rejects(
        () => ReviewStore.setMark(file, { ids: {}, surface: 'afs', status: 'works' }),
        /needs at least one id/,
    );
    assert.equal((await ReviewStore.readState(file)).items.length, 0);
});

test('a fresh store has no marks', async () => {
    const state = await ReviewStore.readState(tempFile());
    assert.equal(state.schema, ReviewStore.SCHEMA);
    assert.deepEqual(state.items, []);
});

test('notes are item-level and survive surface marks', async () => {
    const file = tempFile();
    const item = { ids: { compositionId: 'c2' }, name: 'C2', kind: 'composition' };
    await ReviewStore.setMark(file, { ...item, mode: 'note', note: 'Tagline clips at 8s.' });
    let state = await ReviewStore.readState(file);
    assert.equal(state.items[0].note, 'Tagline clips at 8s.');
    assert.deepEqual(state.items[0].surfaces, {});

    await ReviewStore.setMark(file, { ...item, surface: 'afs', status: 'review' });
    state = await ReviewStore.readState(file);
    assert.equal(state.items[0].note, 'Tagline clips at 8s.');
    assert.equal(state.items[0].surfaces.afs.status, 'review');

    await ReviewStore.setMark(file, { ...item, mode: 'note', note: '' });
    state = await ReviewStore.readState(file);
    assert.equal(state.items[0].note, '');
    assert.equal(state.items[0].surfaces.afs.status, 'review');
});
