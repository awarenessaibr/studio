'use strict';

/**
 * Segment-library contract tests.
 *
 * The generated data lives in data/library/segment-groups (git-ignored, built
 * with `npm run build:segments`). The integration block is skipped when the
 * build has not run; the service tests always run against a temp fixture.
 */

const test = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SegmentLibrary = require('../src/server/segment-library.js');
const server = require('../server.js');

const ROOT = path.join(__dirname, '..');
const LIBRARY = path.join(ROOT, 'data', 'library');
const INDEX_FILE = path.join(LIBRARY, 'segment-groups', 'index.json');
const HAS_BUILD = fs.existsSync(INDEX_FILE);

async function fixture() {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'segment-library-'));
    const libraryDir = path.join(root, 'library');
    const dir = path.join(libraryDir, 'segment-groups');
    await fsp.mkdir(path.join(dir, 'groups'), { recursive: true });
    const group = {
        schema: 'studio/segment-groups/1',
        id: 'clouds-test',
        name: 'Clouds',
        category: 'sky-clouds',
        categoryLabel: 'Sky & clouds',
        members: [{ layerId: 'cloud-1', name: 'cloud-1', box: { x: 0, y: 0, w: 10, h: 10 }, available: true, url: '/data/x.png' }],
        agent: { insert: { layers: [] }, motion: { preset: 'cloud-drift' } },
    };
    const index = {
        schema: 'studio/segment-groups/1',
        generatedAt: '2026-01-01T00:00:00+00:00',
        counts: { groups: 1, layers: 1, categories: 1 },
        categories: [{ id: 'sky-clouds', label: 'Sky & clouds', groupCount: 1, layerCount: 1, groups: ['clouds-test'] }],
        motions: [{ id: 'cloud-drift', label: 'Cloud drift' }],
        groups: [{
            id: 'clouds-test',
            name: 'Clouds',
            category: 'sky-clouds',
            categoryLabel: 'Sky & clouds',
            origin: 'declared',
            layerCount: 1,
            availableCount: 1,
            occurrenceCount: 2,
            source: { projectId: 'demo', compositionId: 'demo', kind: 'import' },
            preview: { card: '', full: '' },
            tags: ['sky'],
            keywords: 'clouds sky demo cloud-1',
            motions: [{ id: 'cloud-drift', label: 'Cloud drift' }],
        }],
        roots: [],
        compositions: [],
        warnings: [],
    };
    const motions = {
        schema: 'studio/segment-group-motions/1',
        generatedAt: index.generatedAt,
        counts: { motions: 1 },
        motions: [{ id: 'cloud-drift', keys: { dx: [[0, 0], [1, 0]] } }],
    };
    await fsp.writeFile(path.join(dir, 'index.json'), JSON.stringify(index));
    await fsp.writeFile(path.join(dir, 'motions.json'), JSON.stringify(motions));
    await fsp.writeFile(path.join(dir, 'groups', 'clouds-test.json'), JSON.stringify(group));
    return { root, libraryDir, index, group };
}

test('segment library service reads, searches and validates', async () => {
    const f = await fixture();
    try {
        const index = await SegmentLibrary.readIndex(f.libraryDir);
        assert.equal(index.schema, 'studio/segment-groups/1');
        assert.equal(index.groups.length, 1);

        const all = SegmentLibrary.search(index, {});
        assert.equal(all.total, 1);

        const matched = SegmentLibrary.search(index, { q: 'cloud' });
        assert.equal(matched.total, 1);
        assert.equal(matched.groups[0].id, 'clouds-test');

        const missed = SegmentLibrary.search(index, { q: 'waves' });
        assert.equal(missed.total, 0);

        const byCategory = SegmentLibrary.search(index, { category: 'sky-clouds', limit: 1 });
        assert.equal(byCategory.groups.length, 1);

        const byOrigin = SegmentLibrary.search(index, { origin: 'inferred' });
        assert.equal(byOrigin.total, 0);

        const detail = await SegmentLibrary.readGroup(f.libraryDir, 'clouds-test');
        assert.equal(detail.members[0].layerId, 'cloud-1');

        await assert.rejects(
            () => SegmentLibrary.readGroup(f.libraryDir, '../escape'),
            (error) => error.statusCode === 400,
        );
        await assert.rejects(
            () => SegmentLibrary.readGroup(f.libraryDir, 'missing-group'),
            (error) => error.statusCode === 404,
        );

        const motions = await SegmentLibrary.readMotions(f.libraryDir);
        assert.equal(motions.motions[0].id, 'cloud-drift');

        const summary = SegmentLibrary.summary(index);
        assert.equal(summary.counts.groups, 1);
        assert.equal(summary.categories[0].id, 'sky-clouds');

        const projects = SegmentLibrary.projectList(index);
        assert.deepEqual(projects, [{ id: 'demo', kind: 'import', groups: 1, layers: 1 }]);
    } finally {
        await fsp.rm(f.root, { recursive: true, force: true });
    }
});

test('missing segment library is a clear 503, not a crash', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'segment-library-empty-'));
    try {
        await assert.rejects(
            () => SegmentLibrary.readIndex(root),
            (error) => error.statusCode === 503 && /build:segments/.test(error.message),
        );
    } finally {
        await fsp.rm(root, { recursive: true, force: true });
    }
});

test('segment library previews are served, markdown is not', () => {
    const thumb = server.libraryPublicFile('/data/library/segment-groups/thumbs/clouds-test.webp');
    assert.ok(thumb && thumb.endsWith(path.join('segment-groups', 'thumbs', 'clouds-test.webp')));
    assert.equal(server.libraryPublicFile('/data/library/segment-groups/README.md'), null);
    assert.equal(server.libraryPublicFile('/data/library/segment-groups/index.json') !== null, true);
    const animation = server.projectPublicFile('/data/projects/demo/animations/one.animation.json');
    assert.ok(animation && animation.endsWith(path.join('animations', 'one.animation.json')));
});

test('segment library page exposes a viewer for every animation kind', async () => {
    const html = await fsp.readFile(path.join(ROOT, 'pages', 'segments.html'), 'utf8');
    assert.match(html, /id="animViewer"/);
    assert.match(html, /data-anim="recipes"/);
    assert.match(html, /id="animTargetGroup"/);
    assert.match(html, /id="animScrub"/);
    assert.match(html, /id="animTrackList"/);
    const script = await fsp.readFile(path.join(ROOT, 'src', 'client', 'segments', 'segments.js'), 'utf8');
    assert.match(script, /function openAnimationViewer/);
    assert.match(script, /function openClipViewer/);
    assert.match(script, /function previewRecipe/);
    assert.match(script, /data-view-animation/);
    assert.match(script, /data-view-clip/);
    assert.match(script, /data-view-recipe/);
});

test('generated segment library is internally consistent', { skip: !HAS_BUILD && 'run npm run build:segments first' }, async () => {
    const index = await SegmentLibrary.readIndex(LIBRARY);
    assert.equal(index.schema, 'studio/segment-groups/1');
    assert.ok(index.groups.length > 0, 'no groups in the built index');
    assert.equal(new Set(index.groups.map((group) => group.id)).size, index.groups.length, 'duplicate group ids');

    const categoryIds = new Set(index.categories.map((category) => category.id));
    const motionIds = new Set((await SegmentLibrary.readMotions(LIBRARY)).motions.map((motion) => motion.id));
    const counts = index.counts;
    assert.equal(counts.groups, index.groups.length);
    assert.equal(counts.layers, index.groups.reduce((sum, group) => sum + group.layerCount, 0));
    assert.ok(counts.categories <= categoryIds.size);

    for (const category of index.categories) {
        const members = index.groups.filter((group) => group.category === category.id);
        assert.equal(category.groupCount, members.length, `category count for ${category.id}`);
        assert.equal(category.layerCount, members.reduce((sum, group) => sum + group.layerCount, 0));
    }

    for (const summary of index.groups) {
        assert.ok(summary.id && summary.name, 'group has id and name');
        assert.ok(categoryIds.has(summary.category), `unknown category on ${summary.id}`);
        assert.ok(['declared', 'folder', 'name', 'role'].includes(summary.origin), `unknown origin on ${summary.id}`);
        assert.ok(summary.source && summary.source.projectId, `${summary.id} has a source`);
        assert.ok(summary.keywords && summary.keywords.includes(summary.name.toLowerCase()), `${summary.id} has keywords`);
        assert.ok(summary.layerCount >= summary.availableCount, `${summary.id} counts are sane`);
        for (const motion of summary.motions || []) assert.ok(motionIds.has(motion.id), `unknown motion ${motion.id}`);

        if (summary.preview.card) {
            const file = path.join(ROOT, summary.preview.card.replace(/^\//, ''));
            assert.ok(fs.existsSync(file), `missing card preview ${summary.preview.card}`);
        }
        if (summary.preview.full) {
            const file = path.join(ROOT, summary.preview.full.replace(/^\//, ''));
            assert.ok(fs.existsSync(file), `missing preview ${summary.preview.full}`);
        }

        const detail = await SegmentLibrary.readGroup(LIBRARY, summary.id);
        assert.equal(detail.id, summary.id);
        assert.equal(detail.members.length, summary.layerCount, `${summary.id} member count`);
        assert.equal(new Set(detail.members.map((member) => member.layerId)).size, detail.members.length);
        assert.ok(detail.agent && Array.isArray(detail.agent.insert.layers), `${summary.id} has an agent insert block`);
        assert.equal(detail.agent.insert.layers.length, summary.availableCount);

        for (const member of detail.members) {
            assert.ok(member.box && member.box.w >= 0 && member.box.h >= 0, `${summary.id}/${member.layerId} box`);
            assert.ok(!String(member.url).startsWith('data:'), `${summary.id}/${member.layerId} is not a data URI`);
            if (member.available) {
                assert.ok(member.file, `${summary.id}/${member.layerId} has a file`);
                assert.ok(fs.existsSync(path.join(ROOT, member.file)), `${summary.id}/${member.layerId} file exists`);
                assert.ok(member.url.startsWith('/data/'), `${summary.id}/${member.layerId} has a public url`);
            }
            for (const key of ['x', 'y', 'w', 'h']) assert.ok(Number.isFinite(member.box[key]), `${summary.id}/${member.layerId} box.${key}`);
        }

        for (const layer of detail.agent.insert.layers) {
            assert.ok(layer.id && layer.url && Number.isFinite(layer.x) && Number.isFinite(layer.z));
        }
    }

    const declared = index.groups.filter((group) => group.origin === 'declared').length;
    assert.equal(counts.declaredGroups, declared);
    assert.equal(counts.inferredGroups, index.groups.length - declared);
});

test('agent search finds the fixture by category and terms', async () => {
    const f = await fixture();
    try {
        const index = await SegmentLibrary.readIndex(f.libraryDir);
        const result = SegmentLibrary.search(index, { q: 'SKY', category: 'sky-clouds', sort: 'layers' });
        assert.equal(result.total, 1);
        assert.equal(result.groups[0].name, 'Clouds');
        assert.equal(result.limit, 60);
        assert.equal(result.offset, 0);
    } finally {
        await fsp.rm(f.root, { recursive: true, force: true });
    }
});
