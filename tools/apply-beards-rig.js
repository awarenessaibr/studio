#!/usr/bin/env node
'use strict';

/**
 * Wire the Beards asset pack into the saved composition as rig v3.
 *
 * The tool is idempotent: it removes any previous `beards-*` asset layers,
 * re-adds them from `assets/manifest.json`, rebuilds the character's part
 * map and updates the agent spec. Existing character settings, applied rig
 * tracks, and animation keyframes on other layers are preserved.
 *
 * Usage:
 *   node tools/apply-beards-rig.js [--project <id>] [--dry]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const projectArg = args.indexOf('--project');
const PROJECT_ID = projectArg >= 0 ? args[projectArg + 1] : 'beards-20261019000756-e757';
const DRY = args.includes('--dry');

const PROJECT_DIR = path.join(ROOT, 'data', 'imports', PROJECT_ID);
const ASSETS_DIR = path.join(PROJECT_DIR, 'assets');
const COMPOSITION_FILE = path.join(PROJECT_DIR, 'composition.json');
const BACKUP_FILE = path.join(PROJECT_DIR, 'composition.pre-v3.json');
const AGENT_FILE = path.join(PROJECT_DIR, 'beards-agent.json');
const URL_BASE = `/data/imports/${PROJECT_ID}/assets`;
const VARIANT_PARTS = new Set(['face', 'eyelids', 'brows', 'mouth', 'jaw', 'highlights']);

function slug(value) {
    return String(value)
        .replace(/\.png$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function round(value) {
    return Math.round(Number(value) * 100) / 100;
}

function main() {
    if (!fs.existsSync(COMPOSITION_FILE)) {
        throw new Error(`No composition at ${COMPOSITION_FILE}`);
    }
    if (!fs.existsSync(path.join(ASSETS_DIR, 'manifest.json'))) {
        throw new Error('No assets/manifest.json. Run tools/build-beards-assets.py first.');
    }

    const manifest = readJson(path.join(ASSETS_DIR, 'manifest.json'));
    const composition = readJson(COMPOSITION_FILE);
    if (!Array.isArray(manifest.assets)) {
        throw new Error('assets/manifest.json must contain an assets array.');
    }
    const missingAssets = manifest.assets
        .filter((entry) => typeof entry.file !== 'string' || !fs.existsSync(path.join(ASSETS_DIR, entry.file)))
        .map((entry) => entry.file || '(unnamed asset)');
    if (missingAssets.length) {
        throw new Error(`Missing asset files: ${missingAssets.join(', ')}`);
    }

    if (!fs.existsSync(BACKUP_FILE)) {
        fs.copyFileSync(COMPOSITION_FILE, BACKUP_FILE);
        console.log(`backup  ${path.relative(ROOT, BACKUP_FILE)}`);
    }

    const existingCharacter = (composition.characters || [])[0] || {};
    const existingLayerById = new Map((composition.layers || []).map((layer) => [layer.id, layer]));
    const wasApplied = existingCharacter.applied === true;
    const width = Number(composition.width) || Number(manifest.canvas?.width) || 348;
    const height = Number(composition.height) || Number(manifest.canvas?.height) || 546;
    const assetIds = new Set(manifest.assets.map((entry) => `beards-${slug(entry.file)}`));
    const removed = (composition.layers || []).filter((layer) => (
        assetIds.has(layer.id) || layer.id === 'rig-cover-character-1'
    )).length;

    // Layers that are just project media re-imported through Add folder /
    // drag-and-drop (a hidden data URL with the same name) are noise: drop them.
    const mediaStems = new Set();
    const collectStems = (dir) => {
        fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
            if (entry.name === '.DS_Store') return;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) collectStems(full);
            else mediaStems.add(entry.name.replace(/\.[a-z0-9]+$/i, '').toLowerCase());
        });
    };
    collectStems(PROJECT_DIR);
    const isDuplicateImport = (layer) => (
        layer
        && layer.visible === false
        && layer.role === 'prop'
        && typeof layer.url === 'string'
        && layer.url.startsWith('data:image')
        && mediaStems.has(String(layer.name || '').toLowerCase())
    );
    const sourceLayer = /^layer-[0-9a-z]-bearded-man-/;
    const kept = (composition.layers || []).filter((layer) => (
        !assetIds.has(layer.id)
        && layer.id !== 'rig-cover-character-1'
        && !isDuplicateImport(layer)
    ));
    kept.forEach((layer) => {
        if (layer.id === 'reference') {
            layer.visible = !wasApplied;
            layer.locked = true;
            layer.positionConfirmed = true;
            return;
        }
        // Original segment layers become provenance: hidden, locked, unlisted.
        // User layers are left alone.
        if (sourceLayer.test(layer.id)) {
            layer.visible = false;
            layer.locked = true;
            layer.rig = true;
            layer.keyframes = [];
            layer.positionConfirmed = true;
        }
    });
    const referenceLayer = kept.find((layer) => layer.id === 'reference');
    if (!referenceLayer) {
        throw new Error('The composition is missing its canonical "reference" layer.');
    }

    const layers = manifest.assets.map((entry) => {
        const id = `beards-${slug(entry.file)}`;
        const url = `${URL_BASE}/${entry.file}`;
        const existingLayer = existingLayerById.get(id);
        return {
            id,
            url,
            frames: [url],
            spriteFps: 1,
            spriteMode: 'once',
            role: entry.role || 'character-part',
            part: entry.part,
            group: entry.group,
            variant: entry.variant,
            name: entry.name,
            x: round(entry.box.x),
            y: round(entry.box.y),
            w: round(entry.box.w),
            h: round(entry.box.h),
            opacity: round(entry.opacity),
            recolorEnabled: false,
            recolorColor: '#ffffff',
            outlineEnabled: false,
            outlineColor: '#000000',
            outlineWidth: 3,
            z: entry.z,
            rotation: 0,
            fit: 'contain',
            visible: true,
            locked: false,
            positionConfirmed: true,
            rig: VARIANT_PARTS.has(entry.part),
            keyframes: Array.isArray(existingLayer?.keyframes) ? existingLayer.keyframes : [],
        };
    });

    const allLayers = [...kept, ...layers].sort((a, b) => {
        if (a.id === 'reference') return -1;
        if (b.id === 'reference') return 1;
        return (Number(a.z) || 0) - (Number(b.z) || 0);
    });

    const partMap = {};
    ['face', 'eyes', 'pupils', 'highlights', 'eyelids', 'brows', 'mouth', 'jaw', 'teeth',
        'tongue', 'mustache', 'beard', 'head', 'body', 'hands', 'ears', 'neck', 'fx',
    ].forEach((part) => { partMap[part] = []; });
    layers.forEach((layer) => {
        if (!partMap[layer.part]) partMap[layer.part] = [];
        partMap[layer.part].push(layer.id);
    });

    const existingSettings = existingCharacter.settings && typeof existingCharacter.settings === 'object'
        ? existingCharacter.settings
        : {};
    const defaults = {
        expression: 'neutral',
        blink: true,
        blinkRate: 12,
        blinkAmount: 0.9,
        talk: false,
        talkIntensity: 0.55,
        talkSpeed: 1,
        mouthOpen: 1,
        gazeX: 0,
        gazeY: 0,
        eyeWander: true,
        breathe: true,
        breatheAmount: 0.4,
        headSway: 0.6,
        pulseAmount: 0,
        saccade: true,
        speechText: '',
        speechRate: 1,
        speechStart: 0,
        mouthPose: '',
    };
    const settings = { ...defaults };
    Object.keys(defaults).forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(existingSettings, key)) {
            settings[key] = existingSettings[key];
        }
    });

    const character = {
        id: 'character-1',
        name: existingCharacter.name || 'Beards',
        parts: partMap,
        hidden: Array.isArray(existingCharacter.hidden) ? existingCharacter.hidden : [],
        coverLayerId: null,
        settings,
        applied: wasApplied,
        detected: existingCharacter.detected !== false,
        rigVersion: 3,
    };

    const next = {
        ...composition,
        version: 1,
        id: composition.id || PROJECT_ID,
        name: composition.name || 'beards',
        width,
        height,
        duration: composition.duration || 10000,
        referenceLayerId: referenceLayer.id,
        characters: [character],
        layers: allLayers,
        meta: {
            ...(composition.meta || {}),
            rig: 'v3',
            assetPack: 'assets/manifest.json',
            updatedAt: new Date().toISOString(),
        },
    };

    const agentSpec = buildAgentSpec(next);
    const summary = {
        project: PROJECT_ID,
        canvas: { width, height },
        referenceLayerId: referenceLayer.id,
        layers: allLayers.length,
        assetLayers: layers.length,
        rigLayers: layers.filter((layer) => layer.rig).length,
        removed,
        applied: character.applied,
        parts: Object.fromEntries(Object.entries(partMap).filter(([, ids]) => ids.length).map(([key, ids]) => [key, ids.length])),
        settings,
    };

    if (DRY) {
        console.log(JSON.stringify(summary, null, 2));
        return;
    }

    writeJson(COMPOSITION_FILE, next);
    writeJson(AGENT_FILE, agentSpec);
    console.log(JSON.stringify(summary, null, 2));
    console.log(`wrote  ${path.relative(ROOT, COMPOSITION_FILE)}`);
    console.log(`wrote  ${path.relative(ROOT, AGENT_FILE)}`);
}

function buildAgentSpec(composition) {
    const characterLayerIds = new Set();
    (composition.characters || []).forEach((character) => {
        Object.values(character.parts || {}).forEach((ids) => {
            if (Array.isArray(ids)) ids.forEach((id) => characterLayerIds.add(id));
        });
        (character.hidden || []).forEach((id) => characterLayerIds.add(id));
    });
    const nonRig = (composition.layers || [])
        .filter((layer) => (
            layer.rig !== true
            && layer.id !== composition.referenceLayerId
            && !characterLayerIds.has(layer.id)
        ))
        .map((layer) => ({
            id: layer.id,
            name: layer.name,
            role: layer.role || 'prop',
            z: layer.z,
            box: {
                x: round(layer.x ?? 0),
                y: round(layer.y ?? 0),
                w: round(layer.w ?? 0),
                h: round(layer.h ?? 0),
            },
            rotation: round(layer.rotation || 0),
            opacity: round(layer.opacity ?? 1),
            sprite: Array.isArray(layer.frames) && layer.frames.length > 1
                ? { frames: layer.frames.length, fps: layer.spriteFps, mode: layer.spriteMode }
                : null,
            keyframes: (layer.keyframes || []).length,
        }));
    return {
        schema: 'layer-studio/agent/v1',
        scene: {
            id: composition.id,
            name: composition.name,
            width: composition.width,
            height: composition.height,
            duration: composition.duration,
        },
        reference: composition.referenceLayerId,
        presetVocabulary: [
            'breathe', 'idle', 'sway', 'walk', 'float', 'flicker', 'drift',
            'pulse', 'fadeIn', 'parallax', 'none',
        ],
        characterPresetVocabulary: [
            'neutral', 'happy', 'sad', 'surprised', 'angry', 'blink', 'talk', 'speak',
            'gaze', 'pulse', 'idle', 'none',
        ],
        characterPartVocabulary: [
            'face', 'eyes', 'pupils', 'highlights', 'eyelids', 'brows', 'mouth', 'jaw',
            'teeth', 'tongue', 'mustache', 'beard', 'head', 'body', 'hands', 'ears',
            'neck', 'fx',
        ],
        visemeVocabulary: ['rest', 'a', 'e', 'i', 'o', 'u', 'mbp', 'fv', 'l', 'wq', 'smile', 'frown', 'open'],
        browPoseVocabulary: ['neutral', 'raised', 'furrowed', 'sad'],
        expressionVocabulary: ['neutral', 'happy', 'sad', 'surprised', 'angry'],
        characters: (composition.characters || []).map((character) => ({
            id: character.id,
            name: character.name,
            rigVersion: character.rigVersion || 0,
            parts: character.parts,
            hidden: character.hidden || [],
            settings: character.settings,
            applied: character.applied === true,
        })),
        layers: nonRig,
        rigLayers: (composition.layers || [])
            .filter((layer) => layer.rig === true || characterLayerIds.has(layer.id))
            .map((layer) => layer.id),
    };
}

try {
    main();
} catch (error) {
    console.error(`apply-beards-rig: ${error.message}`);
    process.exitCode = 1;
}
