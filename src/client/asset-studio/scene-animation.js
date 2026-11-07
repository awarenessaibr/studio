'use strict';

(function (root, factory) {
    const animation = typeof module === 'object' && module.exports
        ? require('./animation')
        : root.AssetStudioAnimation;
    const api = factory(animation);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StudioSceneAnimation = api;
}(typeof globalThis === 'object' ? globalThis : this, function (animation) {
    const MAX_DURATION = 30000;
    const MAX_CUES = 500;
    const ID = /^[A-Za-z0-9_-]{1,80}$/;
    const PRESETS = new Set((animation?.PRESETS || []).map(([id]) => id));
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    function validateManifest(manifest, scene) {
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
            throw new Error('The scene animation file must contain an object.');
        }
        if (manifest.version !== 1 || manifest.type !== 'studio-scene-animation') {
            throw new Error('Unsupported scene animation format. Expected version 1 of studio-scene-animation.');
        }
        if (typeof manifest.id !== 'string' || !ID.test(manifest.id)) {
            throw new Error('The scene animation must have a valid ID.');
        }
        if (typeof manifest.projectId !== 'string' || !ID.test(manifest.projectId)) {
            throw new Error('The scene animation must have a valid project ID.');
        }
        if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
            throw new Error('The scene animation must have a name.');
        }
        if (typeof manifest.sceneId !== 'string' || manifest.sceneId !== scene?.id) {
            throw new Error(`Scene animation "${manifest.name}" targets "${manifest.sceneId || 'no scene'}", not "${scene?.id || 'the loaded scene'}".`);
        }
        if (!Number.isInteger(manifest.duration) || manifest.duration < 500 || manifest.duration > MAX_DURATION) {
            throw new Error(`Scene animation duration must be a whole number from 500 to ${MAX_DURATION} milliseconds.`);
        }
        if (!Array.isArray(manifest.cues) || manifest.cues.length > MAX_CUES) {
            throw new Error(`Scene animation cues must be an array of no more than ${MAX_CUES} entries.`);
        }

        const layers = new Set((scene.layers || []).map((layer) => layer.id));
        const cues = manifest.cues.map((cue, index) => {
            if (!cue || typeof cue !== 'object' || Array.isArray(cue)) {
                throw new Error(`Scene animation cue ${index + 1} is not an object.`);
            }
            if (typeof cue.layerId !== 'string' || !layers.has(cue.layerId)) {
                throw new Error(`Scene animation cue ${index + 1} references missing layer "${cue.layerId || ''}".`);
            }
            if (typeof cue.preset !== 'string' || !PRESETS.has(cue.preset)) {
                throw new Error(`Scene animation cue ${index + 1} uses unsupported preset "${cue.preset || ''}".`);
            }
            if (!Number.isInteger(cue.duration) || cue.duration < 1 || cue.duration > MAX_DURATION) {
                throw new Error(`Scene animation cue ${index + 1} duration must be a whole number from 1 to ${MAX_DURATION} milliseconds.`);
            }
            const delay = cue.delay === undefined ? 0 : cue.delay;
            if (!Number.isInteger(delay) || delay < 0 || delay >= manifest.duration) {
                throw new Error(`Scene animation cue ${index + 1} delay must be a whole number within the scene animation.`);
            }
            if (cue.loop !== true && delay + cue.duration > manifest.duration) {
                throw new Error(`Scene animation cue ${index + 1} ends after the scene animation duration.`);
            }
            if (cue.loop !== undefined && typeof cue.loop !== 'boolean') {
                throw new Error(`Scene animation cue ${index + 1} loop must be true or false.`);
            }
            return { layerId: cue.layerId, preset: cue.preset, duration: cue.duration, delay, loop: cue.loop === true };
        });
        return { ...manifest, name: manifest.name.trim(), cues };
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function applyManifest(scene, sourceManifest) {
        const manifest = validateManifest(sourceManifest, scene);
        const result = clone(scene);
        result.duration = manifest.duration;
        result.name = scene.name || manifest.name;

        const byLayer = new Map();
        manifest.cues.forEach((cue) => {
            if (!byLayer.has(cue.layerId)) byLayer.set(cue.layerId, []);
            byLayer.get(cue.layerId).push(cue);
        });

        byLayer.forEach((cues, layerId) => {
            const layer = result.layers.find((item) => item.id === layerId);
            const base = {
                x: Number(layer.x) || 0,
                y: Number(layer.y) || 0,
                w: Number(layer.w) || 1,
                h: Number(layer.h) || 1,
                rotation: Number(layer.rotation) || 0,
                opacity: Number.isFinite(Number(layer.opacity)) ? Number(layer.opacity) : 1,
            };
            const samples = Math.min(398, Math.max(2, Math.ceil(manifest.duration / 40)));
            const frames = Array.from({ length: samples + 1 }, (_, index) => {
                const time = Math.round(manifest.duration * index / samples);
                const motion = { a: 1, dx: 0, dy: 0, s: 1, sx: 1, sy: 1, r: 0, wipe: null };
                cues.forEach((cue) => {
                    if (time < cue.delay && animation.groupOf(cue.preset) !== 'in') return;
                    const elapsed = Math.max(0, time - cue.delay);
                    const localTime = cue.loop ? cue.delay + (elapsed % cue.duration) : time;
                    const pose = animation.at({
                        preset: cue.preset,
                        start: cue.delay,
                        duration: cue.duration,
                    }, localTime);
                    motion.a *= pose.a ?? 1;
                    motion.dx += pose.dx ?? 0;
                    motion.dy += pose.dy ?? 0;
                    motion.s *= pose.s ?? 1;
                    motion.sx *= pose.sx ?? 1;
                    motion.sy *= pose.sy ?? 1;
                    motion.r += pose.r ?? 0;
                    if (pose.wipe) motion.wipe = pose.wipe;
                });

                const scaleX = motion.s * motion.sx;
                const scaleY = motion.s * motion.sy;
                let w = base.w * scaleX;
                let h = base.h * scaleY;
                let x = base.x + (base.w - w) / 2 + motion.dx * 100;
                let y = base.y + (base.h - h) / 2 + motion.dy * 100;
                if (motion.wipe) {
                    const progress = clamp(motion.wipe.p, 0, 1);
                    if (motion.wipe.d === 'r') w *= progress;
                    else if (motion.wipe.d === 'l') {
                        w *= progress;
                        x += base.w * scaleX - w;
                    } else if (motion.wipe.d === 'd') h *= progress;
                    else if (motion.wipe.d === 'u') {
                        h *= progress;
                        y += base.h * scaleY - h;
                    }
                }
                return {
                    time,
                    x: clamp(x, -100, 200),
                    y: clamp(y, -100, 200),
                    w: clamp(w, 1, 300),
                    h: clamp(h, 1, 300),
                    rotation: clamp(base.rotation + motion.r * 180 / Math.PI, -3600, 3600),
                    opacity: clamp(base.opacity * motion.a, 0, 1),
                };
            });
            layer.keyframes = frames;
        });

        return result;
    }

    return { validateManifest, applyManifest, MAX_DURATION };
}));
