'use strict';
(function (root, factory) {
    const layeredAnimation = factory();
    if (typeof module === 'object' && module.exports) module.exports = layeredAnimation;
    if (root) root.LayeredAnimation = layeredAnimation;
}(typeof globalThis !== 'undefined' ? globalThis : null, function () {
    const SPRITE_URLS = Object.freeze({
        pig: {
            left: '/src/client/studio/animations/butterfly-pig/pig-left.png',
            right: '/src/client/studio/animations/butterfly-pig/pig-right.png',
        },
        butterfly: {
            left: '/src/client/studio/animations/butterfly-pig/butterfly-left.png',
            right: '/src/client/studio/animations/butterfly-pig/butterfly-right.png',
        },
    });

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    function finite(value, label) {
        const number = Number(value);
        if (!Number.isFinite(number)) throw new Error(`Animation data is missing a valid ${label}.`);
        return number;
    }

    function normalizeTrack(points, duration, name) {
        if (!Array.isArray(points) || !points.length) {
            throw new Error(`Animation data has no motion points for ${name}.`);
        }
        return points.map((point) => {
            if (!point || typeof point !== 'object') {
                throw new Error(`Animation data contains an invalid motion point for ${name}.`);
            }
            const time = Math.round(finite(point.timeMs, `${name} time`));
            const facing = point.facing;
            if (time < 0 || time > duration || (facing !== 'left' && facing !== 'right')) {
                throw new Error(`Animation data contains an invalid time or facing direction for ${name}.`);
            }
            return { ...point, time, facing };
        }).sort((a, b) => a.time - b.time);
    }

    function createLayeredAnimation(source, destination, options = {}) {
        if (!source || typeof source !== 'object') throw new Error('Animation data is invalid.');
        const canvasWidth = finite(source?.canvas?.width, 'source canvas width');
        const canvasHeight = finite(source?.canvas?.height, 'source canvas height');
        const duration = Math.round(finite(source?.canvas?.durationMs, 'animation duration'));
        const width = finite(destination?.width, 'destination width');
        const height = finite(destination?.height, 'destination height');
        if (canvasWidth <= 0 || canvasHeight <= 0 || width <= 0 || height <= 0
            || duration < 500 || duration > 30000) {
            throw new Error('Animation and scene dimensions must be positive, and duration must be 500–30000 ms.');
        }
        if (!Array.isArray(source.pig) || !source.pig.length
            || !Array.isArray(source.butterflies) || !source.butterflies.length) {
            throw new Error('The layered animation must contain pig and butterfly motion tracks.');
        }

        const idPrefix = options.idPrefix || `butterfly-pig-${Date.now().toString(36)}`;
        if (!/^[A-Za-z0-9_-]{1,48}$/.test(idPrefix)) {
            throw new Error('Animation layer ID prefix is invalid.');
        }
        const fitScale = Math.min(width / canvasWidth, height / canvasHeight);
        const offsetX = (width - canvasWidth * fitScale) / 2;
        const offsetY = (height - canvasHeight * fitScale) / 2;
        const zStart = clamp(finite(options.zStart ?? 0, 'layer order'), -1000, 1000);
        const layers = [];
        let actorOrder = 0;

        function addActor({ kind, label, points, group }) {
            const first = points[0];
            const actorZ = clamp(zStart + actorOrder, -1000, 1000);
            actorOrder += 1;

            ['left', 'right'].forEach((facing) => {
                const sprite = SPRITE_URLS[kind][facing];
                const aspectRatio = kind === 'pig'
                    ? (facing === 'left' ? 806 / 563 : 717 / 549)
                    : (facing === 'left' ? 182 / 176 : 205 / 174);

                function geometry(point) {
                    let spriteWidth;
                    let spriteHeight;
                    let centerX;
                    let top;
                    if (kind === 'pig') {
                        spriteHeight = 135 * finite(point.scale, `${label} scale`);
                        spriteWidth = spriteHeight * aspectRatio;
                        centerX = finite(point.x, `${label} x`);
                        top = finite(point.groundY, `${label} ground y`)
                            - finite(point.lift, `${label} lift`) - spriteHeight;
                    } else {
                        spriteWidth = finite(point.size, `${label} size`);
                        spriteHeight = spriteWidth / aspectRatio;
                        centerX = finite(point.x, `${label} x`);
                        top = finite(point.y, `${label} y`) - spriteHeight / 2;
                    }
                    if (spriteWidth <= 0 || spriteHeight <= 0) {
                        throw new Error(`Animation data contains an invalid size for ${label}.`);
                    }
                    return {
                        x: (offsetX + (centerX - spriteWidth / 2) * fitScale) / width * 100,
                        y: (offsetY + top * fitScale) / height * 100,
                        w: spriteWidth * fitScale / width * 100,
                        h: spriteHeight * fitScale / height * 100,
                    };
                }

                const keyframes = [];
                if (kind === 'butterfly' && first.time > 0) {
                    keyframes.push({
                        time: 0,
                        ...geometry(first),
                        rotation: 0,
                        opacity: 0,
                    });
                } else if (kind === 'pig' && first.time > 0) {
                    keyframes.push({
                        time: 0,
                        ...geometry(first),
                        rotation: 0,
                        opacity: first.facing === facing ? 1 : 0,
                    });
                }
                points.forEach((point) => {
                    keyframes.push({
                        time: point.time,
                        ...geometry(point),
                        rotation: 0,
                        opacity: point.facing === facing ? 1 : 0,
                    });
                });

                const initial = keyframes[0];
                layers.push({
                    id: `${idPrefix}-${kind}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${facing}`,
                    type: 'image',
                    url: sprite,
                    frames: [sprite],
                    spriteFps: 8,
                    spriteMode: 'loop',
                    role: 'character',
                    name: `${label} (${facing}-facing)`,
                    x: initial.x,
                    y: initial.y,
                    w: initial.w,
                    h: initial.h,
                    opacity: initial.opacity,
                    recolorEnabled: false,
                    recolorColor: '#ffffff',
                    outlineEnabled: false,
                    outlineColor: '#000000',
                    outlineWidth: 3,
                    z: actorZ,
                    rotation: 0,
                    fit: 'contain',
                    visible: true,
                    locked: false,
                    positionConfirmed: true,
                    rig: false,
                    part: '',
                    group: '',
                    segmentGroup: group,
                    variant: facing,
                    bindings: {},
                    keyframes,
                });
            });
        }

        source.butterflies.forEach((butterfly, index) => {
            const label = `Butterfly ${String(index + 1).padStart(2, '0')}`;
            const points = normalizeTrack(butterfly?.track, duration, label).map((point) => ({
                ...point,
                size: finite(point.size, `${label} size`),
                x: finite(point.x, `${label} x`),
                y: finite(point.y, `${label} y`),
            }));
            addActor({ kind: 'butterfly', label, points, group: label });
        });

        const pigPoints = normalizeTrack(source.pig, duration, 'pig').map((point) => ({
            ...point,
            x: finite(point.x, 'pig x'),
            groundY: finite(point.groundY, 'pig ground y'),
            lift: finite(point.lift, 'pig lift'),
            scale: finite(point.scale, 'pig scale'),
        }));
        addActor({ kind: 'pig', label: 'Pig', points: pigPoints, group: 'Pig' });
        return { duration, layers };
    }

    function createCyclistAnimation(source, destination, options = {}) {
        if (!source || typeof source !== 'object' || !Array.isArray(source.layers) || !source.layers.length) {
            throw new Error('Cyclist animation data is invalid.');
        }
        const canvasWidth = finite(source.canvas?.width, 'source canvas width');
        const canvasHeight = finite(source.canvas?.height, 'source canvas height');
        const duration = Math.round(finite(source.canvas?.durationMs, 'animation duration'));
        const width = finite(destination?.width, 'destination width');
        const height = finite(destination?.height, 'destination height');
        if (canvasWidth <= 0 || canvasHeight <= 0 || width <= 0 || height <= 0
            || duration < 500 || duration > 30000) {
            throw new Error('Animation and scene dimensions must be positive, and duration must be 500–30000 ms.');
        }
        const prefix = options.idPrefix || `cyclist-ride-${Date.now().toString(36)}`;
        if (!/^[A-Za-z0-9_-]{1,48}$/.test(prefix)) {
            throw new Error('Animation layer ID prefix is invalid.');
        }
        const fitScale = Math.min(width / canvasWidth, height / canvasHeight);
        const offsetX = (width - canvasWidth * fitScale) / 2;
        const offsetY = (height - canvasHeight * fitScale) / 2;
        const minZ = Math.min(...source.layers.map((layer) => finite(layer.z, 'layer order')));
        const zStart = Math.round(finite(options.zStart ?? 0, 'layer order'));
        if (zStart < -1000 || zStart + source.layers.length - 1 > 1000) {
            throw new Error('There is not enough layer-order range for the cyclist animation.');
        }

        function fitGeometry(state, label) {
            const x = finite(state.x, `${label} x`) / 100 * canvasWidth;
            const y = finite(state.y, `${label} y`) / 100 * canvasHeight;
            const w = finite(state.w, `${label} width`) / 100 * canvasWidth;
            const h = finite(state.h, `${label} height`) / 100 * canvasHeight;
            return {
                x: (offsetX + x * fitScale) / width * 100,
                y: (offsetY + y * fitScale) / height * 100,
                w: w * fitScale / width * 100,
                h: h * fitScale / height * 100,
            };
        }

        const layers = source.layers.map((sourceLayer) => {
            if (!sourceLayer || !Array.isArray(sourceLayer.keyframes) || !sourceLayer.keyframes.length) {
                throw new Error('Every cyclist layer must contain motion keyframes.');
            }
            const label = typeof sourceLayer.name === 'string' ? sourceLayer.name : 'cyclist layer';
            const sourceFrames = [...sourceLayer.keyframes].sort((a, b) => a.time - b.time);
            const keyframes = sourceFrames.map((frame) => {
                const time = Math.round(finite(frame.time, `${label} time`));
                if (time < 0 || time > duration) {
                    throw new Error(`Animation data contains an invalid time for ${label}.`);
                }
                return {
                    ...fitGeometry(frame, label),
                    time,
                    rotation: finite(frame.rotation, `${label} rotation`),
                    opacity: clamp(finite(frame.opacity, `${label} opacity`), 0, 1),
                    ...(typeof frame.easing === 'string' ? { easing: frame.easing } : {}),
                };
            }).sort((a, b) => a.time - b.time);
            const geometry = fitGeometry(sourceFrames[0], label);
            const idPart = String(sourceLayer.name || 'layer').toLowerCase().replace(/[^a-z0-9]+/g, '-');
            return {
                ...sourceLayer,
                id: `${prefix}-${idPart}`,
                ...geometry,
                rotation: finite(keyframes[0].rotation, `${label} rotation`),
                opacity: clamp(finite(keyframes[0].opacity, `${label} opacity`), 0, 1),
                z: zStart + (finite(sourceLayer.z, 'layer order') - minZ),
                keyframes,
            };
        });

        return { duration, layers };
    }

    return { SPRITE_URLS, createLayeredAnimation, createCyclistAnimation };
}));
