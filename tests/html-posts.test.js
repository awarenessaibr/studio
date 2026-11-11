'use strict';
/**
 * HTML stage reels installed as exact-poster designs. Each batch keeps its
 * source recording, a one-layer exact composition, and the extracted
 * multi-layer composition archived for future refinement.
 *
 * Run with: node --test "tests/*.test.js"
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'data', 'library');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const BATCHES = [
    {
        file: path.join(LIB, 'sources', 'three-new-posts.json'),
        brand: 'the-butterfly-and-the-pig',
        ids: [
            'the-butterfly-and-the-pig-new-posts-01',
            'the-butterfly-and-the-pig-new-posts-02',
            'the-butterfly-and-the-pig-new-posts-03',
        ],
        deck: 'butterfly-three-new-posts.html',
        minBytes: 1_000_000,
    },
    {
        file: path.join(LIB, 'sources', 'happy-birthday.json'),
        brand: 'happy-birthday-mum',
        ids: [
            'happy-birthday-mum-3-reels-01',
            'happy-birthday-mum-3-reels-02',
            'happy-birthday-mum-3-reels-03',
        ],
        deck: 'happy-birthday-mum-3-reels.html',
        minBytes: 2_000_000,
    },
    {
        file: path.join(LIB, 'sources', 'vincent-hovorka.json'),
        brand: 'vincent-hovorka',
        ids: [
            'vincent-hovorka-reels-and-post-ideas-01',
            'vincent-hovorka-reels-and-post-ideas-02',
            'vincent-hovorka-reels-and-post-ideas-03',
        ],
        deck: 'vincent-hovorka-reels-and-post-ideas.html',
        minBytes: 500_000,
    },
    {
        file: path.join(LIB, 'sources', 'five-ways-in-vincent.json'),
        brand: 'vincent-hovorka',
        ids: [
            'five-ways-in-vincent-hovorka-series-01',
            'five-ways-in-vincent-hovorka-series-02',
            'five-ways-in-vincent-hovorka-series-03',
            'five-ways-in-vincent-hovorka-series-04',
            'five-ways-in-vincent-hovorka-series-05',
        ],
        deck: 'five-ways-in-vincent-hovorka-series.html',
        minBytes: 100_000,
    },
    {
        file: path.join(LIB, 'sources', 'business-breakthroughs.json'),
        brand: 'business-breakthroughs',
        ids: [
            'business-breakthroughs-reels-and-posts-01',
            'business-breakthroughs-reels-and-posts-02',
            'business-breakthroughs-reels-and-posts-03',
            'business-breakthroughs-reels-and-posts-04',
        ],
        deck: 'business-breakthroughs-reels-and-posts.html',
        minBytes: 10_000,
    },
];

for (const batch of BATCHES) {
    test(`exact-poster designs: ${path.basename(batch.file)}`, { skip: !fs.existsSync(batch.file) }, () => {
        const meta = JSON.parse(fs.readFileSync(batch.file, 'utf8'));
        const index = JSON.parse(fs.readFileSync(path.join(LIB, 'index.json'), 'utf8'));
        const byId = new Map((index.designs || []).map((design) => [design.id, design]));
        assert.deepEqual(meta.designs.map((design) => design.id), batch.ids);
        assert.equal(meta.designs.length, batch.ids.length);

        for (const design of meta.designs) {
            const entry = byId.get(design.id);
            assert.ok(entry, `${design.id} is in the library index`);
            assert.equal(entry.status, 'ready');
            assert.equal(entry.brandId, batch.brand);
            assert.equal(entry.sourceVideo, `/data/library/sources/${design.id}.webm`);
            assert.equal(entry.sourcePoster, `/data/library/sources/${design.id}.jpg`);
            assert.equal(entry.thumbnail, entry.sourcePoster);
            assert.equal(entry.width, design.width);
            assert.equal(entry.height, design.height);
            assert.equal(entry.duration, design.duration);

            const video = path.join(LIB, 'sources', `${design.id}.webm`);
            const poster = path.join(LIB, 'sources', `${design.id}.jpg`);
            assert.ok(fs.statSync(video).size > 1000, `${design.id} has a recording`);
            assert.ok(fs.statSync(poster).size > 1000, `${design.id} has a poster`);

            const detail = JSON.parse(fs.readFileSync(path.join(LIB, 'designs', `${design.id}.json`), 'utf8'));
            assert.equal(detail.layers.length, 1, 'composition is one exact source frame');
            assert.equal(detail.sourceVideo, entry.sourceVideo);
            assert.equal(detail.sourcePoster, entry.sourcePoster);

            const projectPoster = path.join(ROOT, 'data', 'projects', design.id, 'images', 'poster.png');
            assert.equal(sha(projectPoster), design.posterSha256, `${design.id} poster is the recorded frame`);
            const composition = JSON.parse(fs.readFileSync(
                path.join(ROOT, 'data', 'projects', design.id, 'compositions', `${design.id}.composition.json`), 'utf8',
            ));
            assert.equal(composition.layers.length, 1);
            assert.equal(composition.duration, design.duration);
            assert.deepEqual(
                { x: composition.layers[0].x, y: composition.layers[0].y, w: composition.layers[0].w, h: composition.layers[0].h },
                { x: 0, y: 0, w: 100, h: 100 },
            );
            assert.equal(composition.layers[0].url, `/data/projects/${design.id}/images/poster.png`);

            const archive = JSON.parse(fs.readFileSync(
                path.join(ROOT, 'data', 'projects', design.id, 'compositions', `${design.id}.editable.json`), 'utf8',
            ));
            assert.ok(archive.layers.length > 10, `${design.id} keeps the extracted layer composition`);
        }
    });

    test(`source deck archived: ${batch.deck}`, { skip: !fs.existsSync(batch.file) }, () => {
        const source = path.join(LIB, 'sources', 'html', batch.deck);
        assert.ok(fs.existsSync(source));
        assert.ok(fs.statSync(source).size > batch.minBytes);
    });
}
