'use strict';
/**
 * segment-fill.js — rebuild the part of a segment that a segment in front hid.
 *
 * Segmentation exports cut-outs, not a complete stack: wherever another object
 * was painted over a layer, that layer's PNG is transparent. Animating it then
 * reveals the hole. This module reconstructs those pixels from the layer's own
 * surroundings with a coarse-to-fine exemplar synthesis (PatchMatch neighbour
 * search + weighted voting, Wexler-style), so the fill keeps the real texture
 * instead of smearing an average over it.
 *
 * The pixel work has no DOM dependency and runs unchanged under Node for tests:
 *
 *   buildHoleMask()   target alpha + "segments above" alpha -> hole mask
 *   inpaintRGBA()     RGBA buffer + mask -> filled RGBA buffer
 *
 * analyse() and fill() add the canvas work around it: they render the visible
 * segments above the target, map their alpha into the target's own pixel space,
 * run the synthesis at a capped working size and composite the result back over
 * only the hidden pixels. studio-v2.js owns the dialog and the page wiring.
 *
 * Loaded as a plain <script> before studio-v2.js and also require()-able.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.LayerStudioSegmentFill = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const DEFAULTS = {
        patchRadius: 3,
        iterations: 4,
        stride: 2,
        randomSearches: 5,
        seed: 0x5eed5eed,
        maxLevels: 5,
        minLevelEdge: 96,
        // Score at which a patch match starts losing half its vote weight.
        // A 7x7 patch differing by ~15 RGB levels per channel matches this.
        scoreScale: 12_000,
        // How sharply the best patch wins the vote. 1 is a soft average that
        // preserves structure but blurs texture; 3 keeps the grain.
        voteSharpness: 3,
        // How much a hole pixel counts while matching. The current estimate is
        // useful, but the known pixels around the hole are the ground truth.
        holeWeight: 0.6,
        // At the finest level, how strongly the carried-up estimate guides the
        // match. Too low and the fill patches together unrelated materials.
        holeWeightFinest: 0.5,
        // Prefer source material near the hole. A patch from across the image
        // can match the smoothed estimate yet belong to another object.
        locality: 8,
    };

    const MAX_PIXELS = 16 * 1024 * 1024;

    function assertSize(width, height) {
        const w = Math.floor(Number(width));
        const h = Math.floor(Number(height));
        if (!(w > 0 && h > 0)) throw new TypeError('inpaintRGBA needs a positive width and height.');
        if (w * h > MAX_PIXELS) throw new RangeError(`The fill area is too large (${w} x ${h}).`);
        return { width: w, height: h };
    }

    function assertBuffer(rgba, width, height) {
        if (!rgba || typeof rgba.length !== 'number') {
            throw new TypeError('inpaintRGBA needs an RGBA pixel buffer.');
        }
        const size = assertSize(width, height);
        if (rgba.length < size.width * size.height * 4) {
            throw new TypeError('The RGBA buffer is smaller than its stated width and height.');
        }
        return size;
    }

    function mulberry32(seed) {
        let state = seed >>> 0;
        return function next() {
            state = (state + 0x6d2b79f5) | 0;
            let value = Math.imul(state ^ (state >>> 15), 1 | state);
            value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
            return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        };
    }

    function clamp(value, min, max) {
        return value < min ? min : (value > max ? max : value);
    }

    // ---------------------------------------------------------------------
    // Hole mask
    // ---------------------------------------------------------------------

    /**
     * A hole is a pixel the segment leaves transparent and a segment in front
     * paints over. `targetAlpha` and `frontAlpha` are single-channel buffers
     * (one byte per pixel); `coverage` (optional) can restrict the mask to an
     * additional region, e.g. only inside the layer's drawn rectangle.
     *
     * Both thresholds are deliberately soft at the edge: the front segment's
     * anti-aliased rim and the segment's own soft cut line are part of the
     * hole, otherwise a one-pixel fringe of the removed object would survive.
     */
    function buildHoleMask(targetAlpha, frontAlpha, width, height, options = {}) {
        const { width: w, height: h } = assertSize(width, height);
        if (!targetAlpha || !frontAlpha || targetAlpha.length < w * h || frontAlpha.length < w * h) {
            throw new TypeError('buildHoleMask needs one alpha byte per pixel for the target and the front.');
        }
        const frontThreshold = Number.isFinite(options.frontThreshold) ? options.frontThreshold : 40;
        const targetThreshold = Number.isFinite(options.targetThreshold) ? options.targetThreshold : 32;
        const coverage = options.coverage || null;
        const mask = new Uint8Array(w * h);
        let count = 0;
        for (let i = 0; i < mask.length; i += 1) {
            if (coverage && !coverage[i]) continue;
            if (frontAlpha[i] >= frontThreshold && targetAlpha[i] <= targetThreshold) {
                mask[i] = 1;
                count += 1;
            }
        }
        return { mask, count };
    }

    function countMask(mask) {
        let count = 0;
        for (let i = 0; i < mask.length; i += 1) if (mask[i]) count += 1;
        return count;
    }

    /** Grows a mask by one pixel, but only into pixels `allowed` marks. */
    function growMask(mask, width, height, allowed = null) {
        const out = mask.slice();
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const i = y * width + x;
                if (mask[i]) continue;
                if (allowed && !allowed[i]) continue;
                const west = x > 0 && mask[i - 1];
                const east = x < width - 1 && mask[i + 1];
                const north = y > 0 && mask[i - width];
                const south = y < height - 1 && mask[i + width];
                if (west || east || north || south) out[i] = 1;
            }
        }
        return out;
    }

    // ---------------------------------------------------------------------
    // Pyramid
    // ---------------------------------------------------------------------

    function makeLevel(rgba, width, height, mask) {
        const n = width * height;
        const r = new Float32Array(n);
        const g = new Float32Array(n);
        const b = new Float32Array(n);
        const a = new Float32Array(n);
        for (let i = 0; i < n; i += 1) {
            const offset = i * 4;
            const alpha = rgba[offset + 3] / 255;
            a[i] = alpha;
            r[i] = rgba[offset] * alpha;
            g[i] = rgba[offset + 1] * alpha;
            b[i] = rgba[offset + 2] * alpha;
        }
        return { width, height, mask, r, g, b, a };
    }

    function writeLevel(level, rgba) {
        const { width, height } = level;
        for (let i = 0; i < width * height; i += 1) {
            const alpha = level.a[i];
            const offset = i * 4;
            if (alpha <= 0.0001) {
                rgba[offset] = 0;
                rgba[offset + 1] = 0;
                rgba[offset + 2] = 0;
                rgba[offset + 3] = 0;
                continue;
            }
            rgba[offset] = clamp(level.r[i] / alpha, 0, 255);
            rgba[offset + 1] = clamp(level.g[i] / alpha, 0, 255);
            rgba[offset + 2] = clamp(level.b[i] / alpha, 0, 255);
            rgba[offset + 3] = clamp(alpha * 255, 0, 255);
        }
    }

    /** Halves a level, alpha-weighted, and keeps the hole a majority vote. */
    function downsample(level) {
        const width = Math.max(1, level.width >> 1);
        const height = Math.max(1, level.height >> 1);
        const n = width * height;
        const r = new Float32Array(n);
        const g = new Float32Array(n);
        const b = new Float32Array(n);
        const a = new Float32Array(n);
        const mask = new Uint8Array(n);
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const x0 = x * 2;
                const y0 = y * 2;
                const x1 = Math.min(level.width - 1, x0 + 1);
                const y1 = Math.min(level.height - 1, y0 + 1);
                let sr = 0;
                let sg = 0;
                let sb = 0;
                let sa = 0;
                let holes = 0;
                let samples = 0;
                for (let sy = y0; sy <= y1; sy += 1) {
                    const row = sy * level.width;
                    for (let sx = x0; sx <= x1; sx += 1) {
                        const i = row + sx;
                        sr += level.r[i];
                        sg += level.g[i];
                        sb += level.b[i];
                        sa += level.a[i];
                        if (level.mask[i]) holes += 1;
                        samples += 1;
                    }
                }
                const index = y * width + x;
                r[index] = sr / samples;
                g[index] = sg / samples;
                b[index] = sb / samples;
                a[index] = sa / samples;
                mask[index] = holes * 2 >= samples ? 1 : 0;
            }
        }
        return { width, height, r, g, b, a, mask };
    }

    /** Bilinear sample of a coarse level at continuous (x, y). */
    function sampleLevel(level, x, y) {
        const { width, height, r, g, b, a } = level;
        const cx = clamp(x, 0, width - 1);
        const cy = clamp(y, 0, height - 1);
        const x0 = Math.floor(cx);
        const y0 = Math.floor(cy);
        const x1 = Math.min(width - 1, x0 + 1);
        const y1 = Math.min(height - 1, y0 + 1);
        const fx = cx - x0;
        const fy = cy - y0;
        const i00 = y0 * width + x0;
        const i10 = y0 * width + x1;
        const i01 = y1 * width + x0;
        const i11 = y1 * width + x1;
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;
        return {
            r: r[i00] * w00 + r[i10] * w10 + r[i01] * w01 + r[i11] * w11,
            g: g[i00] * w00 + g[i10] * w10 + g[i01] * w01 + g[i11] * w11,
            b: b[i00] * w00 + b[i10] * w10 + b[i01] * w01 + b[i11] * w11,
            a: a[i00] * w00 + a[i10] * w10 + a[i01] * w01 + a[i11] * w11,
        };
    }

    /** Seeds every hole at a finer level from the coarser, filled estimate. */
    function upsampleInto(coarse, fine) {
        const { width, height, mask, r, g, b, a } = fine;
        const scaleX = coarse.width / width;
        const scaleY = coarse.height / height;
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const i = y * width + x;
                if (!mask[i]) continue;
                const value = sampleLevel(coarse, (x + 0.5) * scaleX - 0.5, (y + 0.5) * scaleY - 0.5);
                r[i] = value.r;
                g[i] = value.g;
                b[i] = value.b;
                a[i] = value.a;
            }
        }
    }

    // ---------------------------------------------------------------------
    // Coarsest estimate: diffusion, so patch matching starts from a sane field
    // ---------------------------------------------------------------------

    function diffuseHoles(level, iterations = 160) {
        const { width, height, mask } = level;
        const n = width * height;
        let r = level.r;
        let g = level.g;
        let b = level.b;
        let a = level.a;
        let rNext = new Float32Array(n);
        let gNext = new Float32Array(n);
        let bNext = new Float32Array(n);
        let aNext = new Float32Array(n);
        for (let pass = 0; pass < iterations; pass += 1) {
            rNext.set(r);
            gNext.set(g);
            bNext.set(b);
            aNext.set(a);
            let changed = false;
            for (let y = 0; y < height; y += 1) {
                for (let x = 0; x < width; x += 1) {
                    const i = y * width + x;
                    if (!mask[i]) continue;
                    let sr = 0;
                    let sg = 0;
                    let sb = 0;
                    let sa = 0;
                    let weight = 0;
                    for (let dy = -1; dy <= 1; dy += 1) {
                        const yy = y + dy;
                        if (yy < 0 || yy >= height) continue;
                        for (let dx = -1; dx <= 1; dx += 1) {
                            if (dx === 0 && dy === 0) continue;
                            const xx = x + dx;
                            if (xx < 0 || xx >= width) continue;
                            const j = yy * width + xx;
                            // Nearer neighbours count more; known pixels count
                            // double so the field leans on real data.
                            const w = (dx === 0 || dy === 0 ? 1 : 0.7071) * (mask[j] ? 1 : 2);
                            sr += r[j] * w;
                            sg += g[j] * w;
                            sb += b[j] * w;
                            sa += a[j] * w;
                            weight += w;
                        }
                    }
                    if (!weight) continue;
                    rNext[i] = sr / weight;
                    gNext[i] = sg / weight;
                    bNext[i] = sb / weight;
                    aNext[i] = sa / weight;
                    changed = true;
                }
            }
            if (!changed) break;
            [r, g, b, a, rNext, gNext, bNext, aNext] = [rNext, gNext, bNext, aNext, r, g, b, a];
        }
        level.r = r;
        level.g = g;
        level.b = b;
        level.a = a;
    }

    // ---------------------------------------------------------------------
    // Exemplar synthesis
    // ---------------------------------------------------------------------

    /**
     * One coarse-to-fine iteration of "find a source patch for every patch over
     * the hole, then let every patch vote for the pixels it covers".
     *
     * Sources are patches that contain no hole pixel, so the fill is always
     * built from artwork that really exists. Targets are patches within the
     * patch radius of a hole pixel. The neighbour field is searched with
     * PatchMatch propagation plus random restarts (Barnes et al.), and every
     * hole pixel is rebuilt as a weighted average of the sources that cover it.
     */
    function synthesize(level, options, rng) {
        const { width, height, mask, r, g, b, a } = level;
        const radius = Math.max(1, Math.floor(options.patchRadius));
        const stride = Math.max(1, Math.floor(options.stride));
        const diameter = radius * 2 + 1;
        const n = width * height;
        if (width <= diameter || height <= diameter) return;

        // Integral image of the hole mask, so "does this patch touch a hole?"
        // is one subtraction per patch.
        const integral = new Int32Array((width + 1) * (height + 1));
        for (let y = 0; y < height; y += 1) {
            let row = 0;
            for (let x = 0; x < width; x += 1) {
                row += mask[y * width + x] ? 1 : 0;
                integral[(y + 1) * (width + 1) + (x + 1)] = integral[y * (width + 1) + (x + 1)] + row;
            }
        }
        const holeHits = (x, y) => {
            const left = x - radius;
            const top = y - radius;
            const right = x + radius + 1;
            const bottom = y + radius + 1;
            return integral[bottom * (width + 1) + right]
                - integral[top * (width + 1) + right]
                - integral[bottom * (width + 1) + left]
                + integral[top * (width + 1) + left];
        };

        // Sources: patches entirely outside the hole.
        const sourceIndex = [];
        for (let y = radius; y < height - radius; y += 1) {
            for (let x = radius; x < width - radius; x += 1) {
                if (holeHits(x, y) === 0) sourceIndex.push(y * width + x);
            }
        }
        if (!sourceIndex.length) return;

        // Targets: patches on a grid that touch the hole.
        const targetIndex = [];
        const targetAt = new Int32Array(n).fill(-1);
        for (let y = radius; y < height - radius; y += stride) {
            for (let x = radius; x < width - radius; x += stride) {
                if (holeHits(x, y) === 0) continue;
                targetAt[y * width + x] = targetIndex.length;
                targetIndex.push(y * width + x);
            }
        }
        if (!targetIndex.length) return;

        const targetCount = targetIndex.length;
        const sourceCount = sourceIndex.length;
        const pick = new Int32Array(targetCount);
        const score = new Float64Array(targetCount);

        const distance = (tx, ty, sx, sy) => {
            let total = 0;
            let weight = 0;
            let ty0 = ty - radius;
            let sy0 = sy - radius;
            for (let dy = 0; dy < diameter; dy += 1) {
                let ti = (ty0 + dy) * width + tx - radius;
                let si = (sy0 + dy) * width + sx - radius;
                for (let dx = 0; dx < diameter; dx += 1, ti += 1, si += 1) {
                    const tw = mask[ti] ? options.holeWeight : 1;
                    const dr = r[ti] - r[si];
                    const dg = g[ti] - g[si];
                    const db = b[ti] - b[si];
                    const da = a[ti] - a[si];
                    total += tw * (dr * dr + dg * dg + db * db + da * da * 255);
                    weight += tw;
                }
            }
            return weight ? total / weight : 0;
        };

        for (let i = 0; i < targetCount; i += 1) {
            // Start from a valid match, not from Infinity: a target whose
            // random restarts all land on invalid sources would otherwise
            // never win a vote and keep the smooth pyramid estimate.
            const start = targetIndex[i];
            const sx0 = start % width;
            const sy0 = (start - sx0) / width;
            pick[i] = sourceIndex[(rng() * sourceCount) | 0];
            score[i] = distance(sx0, sy0, pick[i] % width, Math.floor(pick[i] / width));
        }

        const locality = Number.isFinite(options.locality) ? options.locality : 0;
        const near = Number.isFinite(options.localityNear) ? options.localityNear : 24;
        const reach = Math.max(1, width * width + height * height);
        const evaluate = (i, tx, ty, source) => {
            const sx = source % width;
            const sy = (source - sx) / width;
            if (sx < radius || sx >= width - radius || sy < radius || sy >= height - radius) return;
            if (holeHits(sx, sy) !== 0) return;
            let value = distance(tx, ty, sx, sy);
            if (locality) {
                // Prefer the material around the hole: a far-away patch can
                // match the smoothed estimate yet belong to another object.
                const gap = Math.max(0, Math.max(Math.abs(sx - tx), Math.abs(sy - ty)) - near);
                value *= 1 + locality * gap * gap / reach;
            }
            if (value < score[i]) {
                score[i] = value;
                pick[i] = source;
            }
        };

        for (let pass = 0; pass < options.iterations; pass += 1) {
            const forward = pass % 2 === 0;
            for (let step = 0; step < targetCount; step += 1) {
                const i = forward ? step : targetCount - 1 - step;
                const source = targetIndex[i];
                const tx = source % width;
                const ty = (source - tx) / width;
                if (forward) {
                    const leftX = tx - stride;
                    if (leftX >= radius) {
                        const neighbour = targetAt[ty * width + leftX];
                        if (neighbour >= 0) evaluate(i, tx, ty, pick[neighbour] + stride);
                    }
                    const upY = ty - stride;
                    if (upY >= radius) {
                        const neighbour = targetAt[upY * width + tx];
                        if (neighbour >= 0) evaluate(i, tx, ty, pick[neighbour] + stride * width);
                    }
                } else {
                    const rightX = tx + stride;
                    if (rightX < width - radius) {
                        const neighbour = targetAt[ty * width + rightX];
                        if (neighbour >= 0) evaluate(i, tx, ty, pick[neighbour] - stride);
                    }
                    const downY = ty + stride;
                    if (downY < height - radius) {
                        const neighbour = targetAt[downY * width + tx];
                        if (neighbour >= 0) evaluate(i, tx, ty, pick[neighbour] - stride * width);
                    }
                }
                // Random restarts around the current best, shrinking each time.
                let range = Math.max(width, height);
                for (let k = 0; k < options.randomSearches; k += 1) {
                    const sx = clamp((pick[i] % width) + Math.round((rng() * 2 - 1) * range), radius, width - radius - 1);
                    const sy = clamp(Math.floor(pick[i] / width) + Math.round((rng() * 2 - 1) * range), radius, height - radius - 1);
                    evaluate(i, tx, ty, sy * width + sx);
                    range *= 0.5;
                    if (range < 1) break;
                }
            }

            // Vote. Every target patch proposes its source patch for every hole
            // pixel it covers. `average` keeps coarse levels stable; `best`
            // copies the single sharpest patch at the finest level, which is
            // what keeps the artwork's grain instead of averaging it away.
            const best = options.voteMode === 'best';
            const accR = new Float32Array(n);
            const accG = new Float32Array(n);
            const accB = new Float32Array(n);
            const accA = new Float32Array(n);
            const accW = new Float32Array(n);
            const bestScore = best ? new Float32Array(n).fill(Infinity) : null;
            const scale = Math.max(1, options.scoreScale || DEFAULTS.scoreScale);
            for (let i = 0; i < targetCount; i += 1) {
                const sx = pick[i] % width;
                const sy = Math.floor(pick[i] / width);
                const tx = targetIndex[i] % width;
                const ty = Math.floor(targetIndex[i] / width);
                const weight = Math.pow(1 / (1 + score[i] / scale), options.voteSharpness || 2);
                for (let dy = -radius; dy <= radius; dy += 1) {
                    const ty2 = ty + dy;
                    const sy2 = sy + dy;
                    if (ty2 < 0 || ty2 >= height) continue;
                    for (let dx = -radius; dx <= radius; dx += 1) {
                        const tx2 = tx + dx;
                        const sx2 = sx + dx;
                        if (tx2 < 0 || tx2 >= width || sx2 < 0 || sx2 >= width) continue;
                        const ti = ty2 * width + tx2;
                        if (!mask[ti]) continue;
                        const si = sy2 * width + sx2;
                        if (best) {
                            if (score[i] >= bestScore[ti]) continue;
                            bestScore[ti] = score[i];
                            accR[ti] = r[si];
                            accG[ti] = g[si];
                            accB[ti] = b[si];
                            accA[ti] = a[si];
                            accW[ti] = 1;
                            continue;
                        }
                        accR[ti] += r[si] * weight;
                        accG[ti] += g[si] * weight;
                        accB[ti] += b[si] * weight;
                        accA[ti] += a[si] * weight;
                        accW[ti] += weight;
                    }
                }
            }
            for (let i = 0; i < n; i += 1) {
                if (!mask[i] || accW[i] <= 0) continue;
                const w = accW[i];
                // The level keeps colour premultiplied by alpha, which is what
                // the distance, diffusion and downsample steps all expect.
                r[i] = accR[i] / w;
                g[i] = accG[i] / w;
                b[i] = accB[i] / w;
                a[i] = clamp(accA[i] / w, 0, 1);
            }
        }
    }

    /**
     * Fills every masked pixel of an RGBA buffer from the unmasked artwork.
     * Returns a new buffer; the input is not modified.
     *
     *   const { data, filled } = inpaintRGBA(pixels, width, height, mask);
     */
    function inpaintRGBA(rgba, width, height, mask, options = {}) {
        const { width: w, height: h } = assertBuffer(rgba, width, height);
        if (!mask || mask.length < w * h) {
            throw new TypeError('inpaintRGBA needs one mask byte per pixel.');
        }
        const filled = countMask(mask);
        if (!filled) {
            return { data: new Uint8ClampedArray(rgba), width: w, height: h, filled: 0 };
        }
        const settings = { ...DEFAULTS, ...options };
        const rng = mulberry32(settings.seed);

        // Full-resolution working copy and its pyramid.
        const base = makeLevel(rgba, w, h, mask);
        const levels = [base];
        while (levels.length < settings.maxLevels) {
            const previous = levels[levels.length - 1];
            if (Math.max(previous.width, previous.height) <= settings.minLevelEdge) break;
            levels.push(downsample(previous));
        }
        diffusionPass(levels[levels.length - 1], settings);
        for (let index = levels.length - 1; index >= 0; index -= 1) {
            const level = levels[index];
            if (index < levels.length - 1) upsampleInto(levels[index + 1], level);
            synthesize(
                level,
                {
                    ...settings,
                    iterations: index === 0 ? settings.iterations + 1 : settings.iterations,
                    stride: index === 0 ? settings.stride : Math.max(1, settings.stride - 1),
                    // At the finest level the known boundary is the truth; the
                    // smooth estimate carried up from the pyramid would bias
                    // the match towards smooth source patches and lose grain.
                    holeWeight: index === 0
                        ? (Number.isFinite(settings.holeWeightFinest) ? settings.holeWeightFinest : settings.holeWeight * 0.25)
                        : settings.holeWeight,
                    voteMode: index === 0 ? 'best' : 'average',
                },
                rng,
            );
        }

        const output = new Uint8ClampedArray(rgba);
        writeLevel(base, output);
        // Only the hole changes; known pixels keep their original bytes.
        for (let i = 0; i < w * h; i += 1) {
            if (mask[i]) continue;
            const offset = i * 4;
            output[offset] = rgba[offset];
            output[offset + 1] = rgba[offset + 1];
            output[offset + 2] = rgba[offset + 2];
            output[offset + 3] = rgba[offset + 3];
        }
        return { data: output, width: w, height: h, filled };
    }

    function diffusionPass(level, settings = {}) {
        const iterations = Math.max(1, Math.min(200, Math.floor(settings.diffusionIterations || 120)));
        diffuseHoles(level, iterations);
    }

    // ---------------------------------------------------------------------
    // Canvas glue: what is in front, where it lands, and the preview
    // ---------------------------------------------------------------------

    const FILL_DEFAULTS = {
        // The synthesis runs here, then the result is scaled back onto the
        // full-resolution segment. Texture survives the round trip; the
        // pixels that were already visible are never touched.
        maxWorkingEdge: 900,
        maxFrontEdge: 1600,
    };

    function loadImageElement(url) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.decoding = 'async';
            image.onload = () => {
                if (!image.naturalWidth || !image.naturalHeight) {
                    reject(new Error('The segment image has no usable size.'));
                    return;
                }
                resolve(image);
            };
            image.onerror = () => reject(new Error('The segment image could not be loaded.'));
            if (!String(url).startsWith('data:') && !String(url).startsWith('blob:')) {
                image.crossOrigin = 'anonymous';
            }
            image.src = url;
        });
    }

    // 2x3 affine matrices in the canvas convention:
    //   x' = a*x + c*y + e,  y' = b*x + d*y + f
    const translate = (x, y) => ({ a: 1, b: 0, c: 0, d: 1, e: x, f: y });
    const scale = (x, y) => ({ a: x, b: 0, c: 0, d: y, e: 0, f: 0 });
    const rotate = (radians) => ({
        a: Math.cos(radians),
        b: Math.sin(radians),
        c: -Math.sin(radians),
        d: Math.cos(radians),
        e: 0,
        f: 0,
    });
    function multiply(left, right) {
        return {
            a: left.a * right.a + left.c * right.b,
            b: left.b * right.a + left.d * right.b,
            c: left.a * right.c + left.c * right.d,
            d: left.b * right.c + left.d * right.d,
            e: left.a * right.e + left.c * right.f + left.e,
            f: left.b * right.e + left.d * right.f + left.f,
        };
    }
    function invert(matrix) {
        const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
        if (!determinant) return null;
        return {
            a: matrix.d / determinant,
            b: -matrix.b / determinant,
            c: -matrix.c / determinant,
            d: matrix.a / determinant,
            e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
            f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
        };
    }

    function masterFormat(studio) {
        const composition = studio.composition;
        const master = typeof studio.masterFormat === 'function' ? studio.masterFormat() : null;
        if (master && master.width && master.height) {
            return { ...master, isMaster: true };
        }
        return {
            id: 'master',
            label: 'Master',
            isMaster: true,
            width: composition.width,
            height: composition.height,
        };
    }

    function resolveForMaster(studio, layer, format) {
        if (window.StudioCore && typeof window.StudioCore.resolveLayer === 'function') {
            return window.StudioCore.resolveLayer(layer, {
                composition: studio.composition,
                format,
                locale: typeof studio.locale === 'function' ? studio.locale() : 'en',
            });
        }
        return layer;
    }

    /** Where the layer's image pixels land on the master canvas, in canvas px. */
    function placement(studio, layer, imageWidth, imageHeight) {
        const composition = studio.composition;
        const boxWidth = (Number(layer.w) || 0) / 100 * composition.width;
        const boxHeight = (Number(layer.h) || 0) / 100 * composition.height;
        const boxX = (Number(layer.x) || 0) / 100 * composition.width;
        const boxY = (Number(layer.y) || 0) / 100 * composition.height;
        let drawWidth = boxWidth;
        let drawHeight = boxHeight;
        if (layer.fit === 'fill') {
            // Stretched to the box; the whole image occupies the whole box.
        } else if (layer.fit === 'cover') {
            const factor = Math.max(boxWidth / imageWidth, boxHeight / imageHeight);
            drawWidth = imageWidth * factor;
            drawHeight = imageHeight * factor;
        } else {
            const factor = Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
            drawWidth = imageWidth * factor;
            drawHeight = imageHeight * factor;
        }
        return {
            box: { x: boxX, y: boxY, width: boxWidth, height: boxHeight },
            draw: {
                x: boxX + (boxWidth - drawWidth) / 2,
                y: boxY + (boxHeight - drawHeight) / 2,
                width: drawWidth,
                height: drawHeight,
            },
            rotation: (Number(layer.rotation) || 0) * Math.PI / 180,
        };
    }

    function rectCovers(outer, inner, tolerance = 1) {
        return outer.x <= inner.x + tolerance
            && outer.y <= inner.y + tolerance
            && outer.x + outer.width >= inner.x + inner.width - tolerance
            && outer.y + outer.height >= inner.y + inner.height - tolerance;
    }

    function segmentsInFront(studio, layer) {
        const composition = studio.composition;
        const candidates = composition.layers.filter((item) => (
            item
            && item.id !== layer.id
            && item.id !== composition.referenceLayerId
            && item.visible !== false
            && item.rig !== true
            && Number(item.z) > Number(layer.z)
            && (item.type === 'text' || item.type === 'image')
        ));
        return candidates;
    }

    function frontComposite(studio, layers, options) {
        const format = masterFormat(studio);
        const composition = {
            ...studio.composition,
            // The export renderer only draws layers flagged visible; the
            // caller has already chosen the visible segments above.
            layers: layers.map((item) => ({ ...item, visible: true })),
            exportBackground: null,
        };
        const snapshot = studio.createExportSnapshot({ composition, format, time: 0 });
        const edge = Math.max(1, Math.min(
            options.maxFrontEdge,
            Math.max(snapshot.width, snapshot.height),
        ));
        const factor = Math.min(1, edge / Math.max(snapshot.width, snapshot.height));
        const width = Math.max(1, Math.round(snapshot.width * factor));
        const height = Math.max(1, Math.round(snapshot.height * factor));
        return (async () => {
            const assets = await studio.loadExportAssets(snapshot, 2048, Math.max(width, height), 24_000_000);
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
            if (!context) throw new Error('This browser could not create the segment-analysis canvas.');
            studio.renderExportFrame(context, snapshot, assets, 0, width, height);
            // The analysis borrows the export renderer; do not leave its
            // progress line in the toolbar.
            if (typeof studio.setExportProgress === 'function') studio.setExportProgress('');
            return { canvas, width, height, format, snapshot };
        })();
    }

    function alphaOf(image, width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('This browser could not read the segment image.');
        context.drawImage(image, 0, 0, width, height);
        let pixels;
        try {
            pixels = context.getImageData(0, 0, width, height).data;
        } catch (error) {
            throw new Error(`This segment's image cannot be read (${error.message}).`);
        }
        const alpha = new Uint8Array(width * height);
        for (let i = 0; i < alpha.length; i += 1) alpha[i] = pixels[i * 4 + 3];
        return alpha;
    }

    /**
     * Renders the segments in front of `layer` into that layer's own pixel
     * space, so "a segment in front covers this pixel" is a straight alpha
     * comparison against the layer's cut-out.
     */
    async function analyse(studio, layer, options = {}) {
        const settings = { ...FILL_DEFAULTS, ...options };
        if (!studio || !layer) throw new Error('Choose a segment first.');
        if (layer.type !== 'image') throw new Error('Only image segments can be filled.');
        if (!layer.url) throw new Error('This segment has no image to fill.');
        if (layer.videoUrl) throw new Error('This segment is a video; there is no still image to fill.');
        if (layer.id === studio.composition.referenceLayerId) {
            throw new Error('The final image is the reference plate, not a segment.');
        }

        const image = await loadImageElement(layer.url);
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        const format = masterFormat(studio);
        const resolvedTarget = resolveForMaster(studio, layer, format);
        const targetPlacement = placement(studio, resolvedTarget, width, height);
        const targetAlpha = alphaOf(image, width, height);
        const candidates = segmentsInFront(studio, layer);
        const plates = [];
        const usable = [];
        candidates.forEach((candidate) => {
            const resolved = resolveForMaster(studio, candidate, format);
            const frontPlacement = placement(studio, resolved, 1, 1);
            if (rectCovers(frontPlacement.box, targetPlacement.box)) {
                // A segment that covers this one entirely is a backdrop, not
                // an occluder: filling under it would rebuild nothing useful.
                plates.push({ id: candidate.id, name: candidate.name });
                return;
            }
            usable.push(candidate);
        });
        if (!usable.length) {
            throw new Error(plates.length
                ? 'Every segment in front covers this one completely, so there is nothing to rebuild.'
                : 'No visible segment sits in front of this one, so it has no hidden holes.');
        }

        const front = await frontComposite(studio, usable, settings);
        const canvasScale = front.width / studio.composition.width;
        const draw = targetPlacement.draw;
        const centreX = draw.x + draw.width / 2;
        const centreY = draw.y + draw.height / 2;
        // Local segment pixels -> front-canvas pixels.
        const forward = multiply(
            scale(canvasScale, canvasScale),
            multiply(
                translate(centreX, centreY),
                multiply(
                    rotate(targetPlacement.rotation),
                    multiply(
                        translate(-centreX, -centreY),
                        multiply(
                            translate(draw.x, draw.y),
                            scale(draw.width / width, draw.height / height),
                        ),
                    ),
                ),
            ),
        );
        const inverse = invert(forward);
        if (!inverse) throw new Error('This segment has no usable placement to analyse.');

        const local = document.createElement('canvas');
        local.width = width;
        local.height = height;
        const localContext = local.getContext('2d', { willReadFrequently: true });
        if (!localContext) throw new Error('This browser could not create the fill canvas.');
        localContext.imageSmoothingEnabled = true;
        localContext.imageSmoothingQuality = 'high';
        localContext.setTransform(inverse.a, inverse.b, inverse.c, inverse.d, inverse.e, inverse.f);
        localContext.drawImage(front.canvas, 0, 0);
        let frontPixels;
        try {
            frontPixels = localContext.getImageData(0, 0, width, height).data;
        } catch (error) {
            throw new Error(`The segments in front could not be read (${error.message}).`);
        }
        const frontAlpha = new Uint8Array(width * height);
        for (let i = 0; i < frontAlpha.length; i += 1) frontAlpha[i] = frontPixels[i * 4 + 3];
        const { mask, count } = buildHoleMask(targetAlpha, frontAlpha, width, height, settings);
        if (!count) {
            throw new Error('No hidden pixels were found: the segments in front do not overlap this one.');
        }
        // Swallow the soft rim the segmentation left around the removed
        // object: those pixels are semi-transparent remnants with the object's
        // colours, and they read as a bright fringe once the hole is filled.
        // Only grow under pixels a segment in front still covers.
        const rim = new Uint8Array(width * height);
        for (let i = 0; i < rim.length; i += 1) {
            rim[i] = targetAlpha[i] <= 250 && frontAlpha[i] >= 16 ? 1 : 0;
        }
        const grown = growMask(growMask(mask, width, height, rim), width, height, rim);
        const finalMask = countMask(grown) > count ? grown : mask;
        return {
            layerId: layer.id,
            layerName: layer.name,
            composition: studio.composition,
            image,
            width,
            height,
            mask: finalMask,
            hiddenPixels: countMask(finalMask),
            coverage: countMask(finalMask) / (width * height),
            front: usable.map((item) => item.name),
            plates,
            targetPlacement,
            settings,
        };
    }

    function workingSize(width, height, maxEdge) {
        const factor = Math.min(1, maxEdge / Math.max(width, height));
        return {
            width: Math.max(1, Math.round(width * factor)),
            height: Math.max(1, Math.round(height * factor)),
            factor,
        };
    }

    function maskCanvas(mask, width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('This browser could not prepare the fill mask.');
        const data = context.createImageData(width, height);
        for (let i = 0; i < mask.length; i += 1) {
            if (!mask[i]) continue;
            data.data[i * 4] = 255;
            data.data[i * 4 + 1] = 255;
            data.data[i * 4 + 2] = 255;
            data.data[i * 4 + 3] = 255;
        }
        context.putImageData(data, 0, 0);
        return canvas;
    }

    /**
     * Runs the synthesis and returns a full-resolution PNG data URL with only
     * the detected hole replaced.
     */
    async function fill(prepared, options = {}) {
        const settings = { ...prepared.settings, ...options };
        const working = workingSize(prepared.width, prepared.height, settings.maxWorkingEdge);
        const source = document.createElement('canvas');
        source.width = working.width;
        source.height = working.height;
        const sourceContext = source.getContext('2d', { willReadFrequently: true });
        if (!sourceContext) throw new Error('This browser could not prepare the segment pixels.');
        sourceContext.imageSmoothingEnabled = true;
        sourceContext.imageSmoothingQuality = 'high';
        sourceContext.drawImage(prepared.image, 0, 0, working.width, working.height);
        const sourcePixels = sourceContext.getImageData(0, 0, working.width, working.height);
        if (working.width !== prepared.width || working.height !== prepared.height) {
            const scaled = maskCanvas(prepared.mask, prepared.width, prepared.height);
            sourceContext.clearRect(0, 0, working.width, working.height);
            sourceContext.drawImage(scaled, 0, 0, working.width, working.height);
            const scaledMask = sourceContext.getImageData(0, 0, working.width, working.height).data;
            const mask = new Uint8Array(working.width * working.height);
            for (let i = 0; i < mask.length; i += 1) mask[i] = scaledMask[i * 4 + 3] > 8 ? 1 : 0;
            if (!countMask(mask)) throw new Error('The hidden area is too small to fill at this resolution.');
            const result = inpaintRGBA(sourcePixels.data, working.width, working.height, mask, settings);
            const filled = document.createElement('canvas');
            filled.width = working.width;
            filled.height = working.height;
            filled.getContext('2d').putImageData(new ImageData(result.data, working.width, working.height), 0, 0);
            return compositeBack(prepared, filled);
        }
        const result = inpaintRGBA(sourcePixels.data, working.width, working.height, prepared.mask, settings);
        const filled = document.createElement('canvas');
        filled.width = working.width;
        filled.height = working.height;
        filled.getContext('2d').putImageData(new ImageData(result.data, working.width, working.height), 0, 0);
        return compositeBack(prepared, filled);
    }

    function compositeBack(prepared, filled) {
        const canvas = document.createElement('canvas');
        canvas.width = prepared.width;
        canvas.height = prepared.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('This browser could not assemble the filled segment.');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(filled, 0, 0, prepared.width, prepared.height);
        const upscaled = context.getImageData(0, 0, prepared.width, prepared.height);
        const original = prepared.originalPixels
            || (() => {
                const base = document.createElement('canvas');
                base.width = prepared.width;
                base.height = prepared.height;
                const baseContext = base.getContext('2d', { willReadFrequently: true });
                baseContext.drawImage(prepared.image, 0, 0);
                return baseContext.getImageData(0, 0, prepared.width, prepared.height).data;
            })();
        if (!prepared.originalPixels) prepared.originalPixels = original;
        const out = upscaled.data;
        const mask = prepared.mask;

        // Plug pinholes: the synthesis may decide a hole pixel is transparent
        // because the nearest matching artwork is, which leaves a one-pixel
        // gap against a solid edge. Anything inside the detected hole that
        // touches solid fill becomes solid too.
        for (let pass = 0; pass < 3; pass += 1) {
            let patched = 0;
            const source = out.slice();
            for (let y = 0; y < prepared.height; y += 1) {
                for (let x = 0; x < prepared.width; x += 1) {
                    const i = y * prepared.width + x;
                    if (!mask[i]) continue;
                    const offset = i * 4;
                    if (source[offset + 3] >= 96) continue;
                    let r = 0;
                    let g = 0;
                    let b = 0;
                    let weight = 0;
                    for (let dy = -1; dy <= 1; dy += 1) {
                        const yy = y + dy;
                        if (yy < 0 || yy >= prepared.height) continue;
                        for (let dx = -1; dx <= 1; dx += 1) {
                            if (dx === 0 && dy === 0) continue;
                            const xx = x + dx;
                            if (xx < 0 || xx >= prepared.width) continue;
                            const j = yy * prepared.width + xx;
                            const jOffset = j * 4;
                            if (source[jOffset + 3] < 200) continue;
                            r += source[jOffset];
                            g += source[jOffset + 1];
                            b += source[jOffset + 2];
                            weight += 1;
                        }
                    }
                    if (weight < 2) continue;
                    out[offset] = Math.round(r / weight);
                    out[offset + 1] = Math.round(g / weight);
                    out[offset + 2] = Math.round(b / weight);
                    out[offset + 3] = 255;
                    patched += 1;
                }
            }
            if (!patched) break;
        }
        // Blend the upscaled fill into the known edge over one pixel, so the
        // seam does not read as a sharp rectangle of new texture.
        for (let y = 0; y < prepared.height; y += 1) {
            for (let x = 0; x < prepared.width; x += 1) {
                const i = y * prepared.width + x;
                const offset = i * 4;
                if (!mask[i]) {
                    out[offset] = original[offset];
                    out[offset + 1] = original[offset + 1];
                    out[offset + 2] = original[offset + 2];
                    out[offset + 3] = original[offset + 3];
                    continue;
                }
                const edge = (x === 0 || !mask[i - 1])
                    || (x === prepared.width - 1 || !mask[i + 1])
                    || (y === 0 || !mask[i - prepared.width])
                    || (y === prepared.height - 1 || !mask[i + prepared.width]);
                if (!edge) continue;
                // Transparent source pixels carry arbitrary RGB from the tool
                // that cut the layer out; blending it in would draw a bright
                // halo along the hole. Weigh the blur by what was visible.
                const visible = original[offset + 3] / 255;
                const mix = 0.3 * visible;
                out[offset] = Math.round(out[offset] * (1 - mix) + original[offset] * mix);
                out[offset + 1] = Math.round(out[offset + 1] * (1 - mix) + original[offset + 1] * mix);
                out[offset + 2] = Math.round(out[offset + 2] * (1 - mix) + original[offset + 2] * mix);
                out[offset + 3] = Math.max(out[offset + 3], original[offset + 3]);
            }
        }
        context.putImageData(new ImageData(out, prepared.width, prepared.height), 0, 0);
        return {
            dataUrl: canvas.toDataURL('image/png'),
            width: prepared.width,
            height: prepared.height,
            hiddenPixels: prepared.hiddenPixels,
        };
    }

    /** A checkerboard-backed PNG for the dialog, so holes are unmistakable. */
    function preview(source, width, height, maxEdge = 560) {
        const factor = Math.min(1, maxEdge / Math.max(width, height));
        const outWidth = Math.max(1, Math.round(width * factor));
        const outHeight = Math.max(1, Math.round(height * factor));
        const canvas = document.createElement('canvas');
        canvas.width = outWidth;
        canvas.height = outHeight;
        const context = canvas.getContext('2d');
        if (!context) return '';
        const square = 10;
        for (let y = 0; y < outHeight; y += square) {
            for (let x = 0; x < outWidth; x += square) {
                context.fillStyle = ((x / square + y / square) % 2 === 0) ? '#2a2933' : '#1b1a21';
                context.fillRect(x, y, square, square);
            }
        }
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(source, 0, 0, outWidth, outHeight);
        return canvas.toDataURL('image/png');
    }

    return {
        DEFAULTS,
        FILL_DEFAULTS,
        buildHoleMask,
        countMask,
        growMask,
        inpaintRGBA,
        analyse,
        fill,
        preview,
    };
}));
