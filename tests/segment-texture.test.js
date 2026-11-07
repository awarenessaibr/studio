'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateSegmentTexture } = require('../src/server/segment-texture.js');

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
    'base64',
);
const PNG_DATA_URL = `data:image/png;base64,${PNG.toString('base64')}`;

test('segment texture generation uploads both images, submits the workflow, and returns its PNG', async () => {
    let workflow;
    let historyPolls = 0;
    const fetchImpl = async (input, options = {}) => {
        const url = new URL(input);
        if (url.pathname === '/upload/image') {
            assert.equal(options.method, 'POST');
            assert.ok(options.body instanceof FormData);
            assert.equal(options.body.get('type'), 'input');
            const image = options.body.get('image');
            assert.ok(image instanceof Blob);
            return new Response(JSON.stringify({
                name: image.name.startsWith('segment-input') ? 'segment.png' : 'texture.webp',
                subfolder: image.name.startsWith('segment-input') ? 'segments' : 'textures',
            }), { status: 200 });
        }
        if (url.pathname === '/prompt') {
            workflow = JSON.parse(options.body).prompt;
            return new Response(JSON.stringify({ prompt_id: 'texture-job' }), { status: 200 });
        }
        if (url.pathname === '/history/texture-job') {
            historyPolls += 1;
            return new Response(JSON.stringify(historyPolls === 1 ? {} : {
                'texture-job': {
                    status: { completed: true, status_str: 'success' },
                    outputs: { '469': { images: [{ filename: 'generated.png', type: 'output' }] } },
                },
            }), { status: 200 });
        }
        if (url.pathname === '/view') {
            assert.equal(url.searchParams.get('filename'), 'generated.png');
            assert.equal(url.searchParams.get('type'), 'output');
            return new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
        }
        throw new Error(`Unexpected ComfyUI request: ${url}`);
    };

    const image = await generateSegmentTexture({
        segmentImage: PNG_DATA_URL,
        textureImage: PNG_DATA_URL,
        textureName: 'Blue ground',
        prompt: 'Use a fine woven finish.',
    }, { baseUrl: 'http://127.0.0.1:8188', fetchImpl, pollIntervalMs: 0 });

    assert.equal(image, PNG_DATA_URL);
    assert.equal(historyPolls, 2);
    assert.equal(workflow['78'].inputs.image, 'segments/segment.png');
    assert.equal(workflow['79'].inputs.image, 'textures/texture.webp');
    assert.deepEqual(workflow['433:111'].inputs.image2, ['79', 0]);
    assert.match(workflow['433:111'].inputs.prompt, /preserve the exact subject, silhouette, geometry/i);
    assert.match(workflow['433:111'].inputs.prompt, /Use a fine woven finish/);
    assert.equal(workflow['469'].inputs.filename_prefix, 'Segment_Texture_Blue_ground');
});

test('segment texture generation rejects invalid inputs before contacting ComfyUI', async () => {
    let requests = 0;
    await assert.rejects(
        () => generateSegmentTexture({
            segmentImage: 'data:image/png;base64,AQIDBA==',
            textureImage: PNG_DATA_URL,
            textureName: 'Blue ground',
        }, { fetchImpl: async () => { requests += 1; } }),
        { status: 400, message: /does not match its declared image format/i },
    );
    assert.equal(requests, 0);
});

test('segment texture generation reports workflow validation errors from ComfyUI', async () => {
    let uploads = 0;
    const fetchImpl = async (input) => {
        const url = new URL(input);
        if (url.pathname === '/upload/image') {
            uploads += 1;
            return new Response(JSON.stringify({ name: `input-${uploads}.png` }), { status: 200 });
        }
        if (url.pathname === '/prompt') {
            return new Response(JSON.stringify({ node_errors: { '433:111': { errors: [] } } }), { status: 200 });
        }
        throw new Error(`Unexpected ComfyUI request: ${url}`);
    };

    await assert.rejects(
        () => generateSegmentTexture({
            segmentImage: PNG_DATA_URL,
            textureImage: PNG_DATA_URL,
            textureName: 'Blue ground',
        }, { fetchImpl }),
        { status: 502, message: /rejected the texture workflow/i },
    );
    assert.equal(uploads, 2);
});
