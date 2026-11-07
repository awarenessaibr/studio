'use strict';

const workflowTemplate = require('./workflows/segment-texture.json');

const MAX_IMAGE_BYTES = 80 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;
const GENERATION_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 1000;

function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function imageBuffer(dataUrl, label) {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(String(dataUrl || ''));
    if (!match) throw httpError(400, `${label} must be a PNG, JPEG, or WebP data URL.`);
    const encoded = match[2];
    if (encoded.length % 4 !== 0) throw httpError(400, `${label} has invalid base64 image data.`);
    if (encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
        throw httpError(413, `${label} exceeds the 80 MB limit.`);
    }
    const buffer = Buffer.from(encoded, 'base64');
    if (!buffer.length) throw httpError(400, `${label} is empty.`);
    if (buffer.length > MAX_IMAGE_BYTES) throw httpError(413, `${label} exceeds the 80 MB limit.`);
    if (buffer.toString('base64') !== encoded) throw httpError(400, `${label} has invalid base64 image data.`);
    const mime = `image/${match[1].toLowerCase()}`;
    const validSignature = mime === 'image/png'
        ? buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        : (mime === 'image/jpeg'
            ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
            : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP');
    if (!validSignature) throw httpError(400, `${label} does not match its declared image format.`);
    return { buffer, mime };
}

function slug(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || 'texture';
}

function endpoint(baseUrl, path) {
    return new URL(path, `${baseUrl.replace(/\/+$/, '')}/`);
}

async function responseJson(response, action) {
    let data;
    try {
        data = await response.json();
    } catch {
        throw httpError(502, `ComfyUI returned an invalid response while ${action}.`);
    }
    if (!data || typeof data !== 'object') {
        throw httpError(502, `ComfyUI returned an invalid response while ${action}.`);
    }
    if (!response.ok) {
        const detail = typeof data.error === 'string' ? data.error : '';
        throw httpError(502, `ComfyUI could not ${action}${detail ? `: ${detail}` : ` (HTTP ${response.status})`}.`);
    }
    return data;
}

async function uploadImage(fetchImpl, baseUrl, image, label, fileName) {
    const extension = image.mime === 'image/jpeg' ? 'jpg' : image.mime.slice('image/'.length);
    const form = new FormData();
    form.append('image', new Blob([image.buffer], { type: image.mime }), `${fileName}.${extension}`);
    form.append('type', 'input');
    form.append('overwrite', 'true');
    let response;
    try {
        response = await fetchImpl(endpoint(baseUrl, 'upload/image'), {
            method: 'POST',
            body: form,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        throw httpError(502, `Could not upload the ${label.toLowerCase()} to ComfyUI: ${error.message}`);
    }
    const uploaded = await responseJson(response, `upload the ${label.toLowerCase()}`);
    if (typeof uploaded.name !== 'string' || !uploaded.name) {
        throw httpError(502, `ComfyUI did not return a filename for the ${label.toLowerCase()}.`);
    }
    return uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name;
}

async function waitForImage(fetchImpl, baseUrl, promptId, pollIntervalMs) {
    const deadline = Date.now() + GENERATION_TIMEOUT_MS;
    while (Date.now() < deadline) {
        let response;
        try {
            response = await fetchImpl(endpoint(baseUrl, `history/${encodeURIComponent(promptId)}`), {
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (error) {
            throw httpError(502, `Could not check the ComfyUI generation status: ${error.message}`);
        }
        const history = await responseJson(response, 'check the generation status');
        const job = history[promptId];
        if (job) {
            const images = Object.values(job.outputs || {})
                .flatMap((output) => Array.isArray(output.images) ? output.images : []);
            if (images.length) return images[0];
            if (job.status?.status_str === 'error' || job.status?.completed) {
                throw httpError(502, 'ComfyUI finished the workflow without producing an image.');
            }
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw httpError(504, 'ComfyUI did not finish generating the texture within 15 minutes.');
}

async function generateSegmentTexture(payload, {
    baseUrl = process.env.COMFYUI_URL || 'http://127.0.0.1:8188',
    fetchImpl = fetch,
    pollIntervalMs = POLL_INTERVAL_MS,
} = {}) {
    let comfyUrl;
    try {
        comfyUrl = new URL(baseUrl);
    } catch {
        throw httpError(503, 'Set COMFYUI_URL to a valid ComfyUI server URL.');
    }
    if (!['http:', 'https:'].includes(comfyUrl.protocol)) {
        throw httpError(503, 'COMFYUI_URL must use HTTP or HTTPS.');
    }
    const normalizedBaseUrl = comfyUrl.toString().replace(/\/+$/, '');
    const textureName = String(payload.textureName || '').trim().slice(0, 120);
    const guidance = String(payload.prompt || '').trim().slice(0, 1000);
    if (!textureName) throw httpError(400, 'Choose a texture image before generating.');

    const segmentImage = imageBuffer(payload.segmentImage, 'Segment image');
    const textureImage = imageBuffer(payload.textureImage, 'Texture image');
    const [segmentFile, textureFile] = await Promise.all([
        uploadImage(fetchImpl, normalizedBaseUrl, segmentImage, 'Segment image', 'segment-input'),
        uploadImage(fetchImpl, normalizedBaseUrl, textureImage, 'Texture image', 'texture-input'),
    ]);

    const workflow = structuredClone(workflowTemplate);
    workflow['78'].inputs.image = segmentFile;
    workflow['79'].inputs.image = textureFile;
    workflow['433:111'].inputs.prompt = [
        `Apply the surface texture/material from reference image 2 to image 1. Preserve the exact subject, silhouette, geometry, pose, crop, lighting, and original background/transparency of image 1. Change only the surface texture/material. Do not copy objects or composition from image 2.`,
        guidance,
    ].filter(Boolean).join(' ');
    workflow['469'].inputs.filename_prefix = `Segment_Texture_${slug(textureName)}`;

    let promptResponse;
    try {
        promptResponse = await fetchImpl(endpoint(normalizedBaseUrl, 'prompt'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: workflow }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        throw httpError(502, `Could not submit the texture workflow to ComfyUI: ${error.message}`);
    }
    const queued = await responseJson(promptResponse, 'queue the texture workflow');
    if (queued.node_errors && Object.keys(queued.node_errors).length) {
        throw httpError(502, 'ComfyUI rejected the texture workflow. Check that the workflow models and custom nodes are installed.');
    }
    if (typeof queued.prompt_id !== 'string' || !queued.prompt_id) {
        throw httpError(502, 'ComfyUI did not return a generation ID.');
    }

    const output = await waitForImage(fetchImpl, normalizedBaseUrl, queued.prompt_id, pollIntervalMs);
    if (typeof output.filename !== 'string' || !output.filename) {
        throw httpError(502, 'ComfyUI finished without returning an output filename.');
    }
    const viewUrl = endpoint(normalizedBaseUrl, 'view');
    viewUrl.search = new URLSearchParams({
        filename: output.filename,
        subfolder: output.subfolder || '',
        type: output.type || 'output',
    }).toString();
    let imageResponse;
    try {
        imageResponse = await fetchImpl(viewUrl, {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        throw httpError(502, `Could not retrieve the generated texture from ComfyUI: ${error.message}`);
    }
    if (!imageResponse.ok) {
        throw httpError(502, `ComfyUI could not return the generated image (HTTP ${imageResponse.status}).`);
    }
    const image = Buffer.from(await imageResponse.arrayBuffer());
    if (!image.length || image.length > MAX_IMAGE_BYTES) {
        throw httpError(502, 'ComfyUI returned an empty image or an image larger than 80 MB.');
    }
    return `data:image/png;base64,${image.toString('base64')}`;
}

module.exports = { generateSegmentTexture };
