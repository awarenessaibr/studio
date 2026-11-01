'use strict';
/**
 * Print-pack writer for Asset Studio.
 *
 * Produces a CMYK PDF with a bleed box, trim box, optional crop marks and a
 * safe-zone checker for the text/logo boxes recorded by the canvas engine.
 *
 * The CMYK conversion is a direct RGB→CMYK conversion (no ICC profile). It is
 * suitable for a straightforward print pack; a printer that requires PDF/X or
 * a specific coated/uncoated profile should apply its own conversion.
 */
(() => {
    const PT_PER_MM = 72 / 25.4;
    const MM_PER_INCH = 25.4;

    const PRINT_SPECS = {
        flyer: {
            'A4 portrait': { w: 210, h: 297, print: true },
            'A3 poster': { w: 297, h: 420, print: true },
            'Portrait 4:5': { w: 108, h: 135, print: false },
            'Story 9:16': { w: 108, h: 192, print: false },
        },
        menu: {
            'A4 portrait': { w: 210, h: 297, print: true },
            'Slim DL': { w: 99, h: 210, print: true },
            'Story 9:16': { w: 108, h: 192, print: false },
        },
        voucher: {
            'Wide card': { w: 210, h: 99, print: true },
            'A5 landscape': { w: 210, h: 148, print: true },
            'Digital 16:9': { w: 160, h: 90, print: false },
        },
        bizcard: {
            Front: { w: 85, h: 55, print: true },
            Back: { w: 85, h: 55, print: true },
            'Both sides': { w: 85, h: 55, print: true, sides: 2 },
        },
        tablecard: {
            'A5 portrait': { w: 148, h: 210, print: true },
            Square: { w: 200, h: 200, print: true },
        },
        social: {
            Square: { w: 108, h: 108, print: false },
            'Portrait 4:5': { w: 108, h: 135, print: false },
            'Story 9:16': { w: 108, h: 192, print: false },
        },
    };

    const round = (value, digits = 1) => {
        const factor = 10 ** digits;
        return Math.round(value * factor) / factor;
    };

    const resolveSpec = (categoryId, size) => {
        const known = PRINT_SPECS[categoryId]?.[size?.n];
        if (known) {
            return {
                ...known,
                shape: size?.shape || null,
                sides: size?.sides || known.sides || 1,
                dpi: size?.dpi || null,
                largeFormat: Boolean(size?.largeFormat),
                name: size.n,
                categoryId,
                derived: false,
                digital: !known.print,
            };
        }
        // Expansion sizes carry their physical millimetres directly; screen-only
        // presets set print:false and never reach the print pack.
        if (Array.isArray(size?.mm) && size.mm.length === 2) {
            return {
                w: Number(size.mm[0]),
                h: Number(size.mm[1]),
                print: size.print !== false,
                digital: size.print === false,
                shape: size.shape || null,
                sides: size.sides || 1,
                dpi: size.dpi || null,
                largeFormat: Boolean(size.largeFormat),
                name: size.n,
                categoryId,
                derived: false,
            };
        }
        // Unknown sizes still get a physical page: assume 150 dpi.
        const width = round((Number(size?.w) || 1080) / 150 * MM_PER_INCH);
        const height = round((Number(size?.h) || 1080) / 150 * MM_PER_INCH);
        return {
            w: width,
            h: height,
            print: false,
            digital: true,
            derived: true,
            shape: size?.shape || null,
            sides: size?.sides || 1,
            name: size?.n || 'Custom',
            categoryId,
        };
    };

    const canCompress = () => typeof CompressionStream === 'function';

    const compress = async (bytes) => {
        if (!canCompress()) return null;
        const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
        const buffer = await new Response(stream).arrayBuffer();
        return new Uint8Array(buffer);
    };

    /**
     * Convert RGBA canvas pixels to DeviceCMYK samples, compositing any alpha
     * over white first. Direct conversion: K = 1 - max(R,G,B).
     */
    const cmykFromRgba = (data, width, height) => {
        const out = new Uint8Array(width * height * 4);
        for (let index = 0, target = 0; index < data.length; index += 4, target += 4) {
            const alpha = data[index + 3] / 255;
            const red = (data[index] * alpha + 255 * (1 - alpha)) / 255;
            const green = (data[index + 1] * alpha + 255 * (1 - alpha)) / 255;
            const blue = (data[index + 2] * alpha + 255 * (1 - alpha)) / 255;
            const black = 1 - Math.max(red, green, blue);
            if (black >= 0.999) {
                out[target] = 0;
                out[target + 1] = 0;
                out[target + 2] = 0;
                out[target + 3] = 255;
                continue;
            }
            const inverse = 1 - black;
            out[target] = Math.round(((1 - red - black) / inverse) * 255);
            out[target + 1] = Math.round(((1 - green - black) / inverse) * 255);
            out[target + 2] = Math.round(((1 - blue - black) / inverse) * 255);
            out[target + 3] = Math.round(black * 255);
        }
        return out;
    };

    /**
     * Compare text/logo boxes to the trim edge.
     * Boxes are in preview pixels; scaleX/scaleY are px per mm.
     */
    const checkBoxes = (boxes, trimW, trimH, scaleX, scaleY, safeMm) => {
        const violations = [];
        (boxes || []).forEach((box) => {
            if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y) || !Number.isFinite(box.w) || !Number.isFinite(box.h)) return;
            const left = box.x / scaleX;
            const top = box.y / scaleY;
            const right = trimW - (box.x + box.w) / scaleX;
            const bottom = trimH - (box.y + box.h) / scaleY;
            const distances = [
                ['left', left],
                ['top', top],
                ['right', right],
                ['bottom', bottom],
            ];
            const breached = distances.filter(([, distance]) => distance < safeMm);
            if (!breached.length) return;
            violations.push({
                kind: box.kind || 'text',
                text: box.text || '',
                side: box.side || 'f',
                x: box.x,
                y: box.y,
                w: box.w,
                h: box.h,
                min: Math.max(0, Math.min(...distances.map(([, distance]) => distance))),
                edges: breached.map(([edge, distance]) => ({ edge, distance: Math.max(0, distance) })),
            });
        });
        return violations.sort((a, b) => a.min - b.min);
    };

    const pageMetrics = (page) => {
        const { trimW, trimH, bleed, slug, marks } = page;
        const margin = marks ? slug : 0;
        const mediaW = trimW + bleed * 2 + margin * 2;
        const mediaH = trimH + bleed * 2 + margin * 2;
        return {
            mediaW,
            mediaH,
            bleedX: margin,
            bleedY: margin,
            bleedW: trimW + bleed * 2,
            bleedH: trimH + bleed * 2,
            trimX: margin + bleed,
            trimY: margin + bleed,
            trimW,
            trimH,
            margin,
        };
    };

    const mm = (value) => `${round(value * PT_PER_MM, 3)}`;

    const markOperations = (page) => {
        if (!page.marks || !page.slug) return '';
        const metrics = pageMetrics(page);
        const marginPt = metrics.margin * PT_PER_MM;
        const gap = Math.min(0.5, page.slug / 2) * PT_PER_MM;
        const end = Math.max(1, marginPt - gap);
        const pageW = metrics.mediaW * PT_PER_MM;
        const pageH = metrics.mediaH * PT_PER_MM;
        const left = metrics.trimX * PT_PER_MM;
        const right = (metrics.trimX + metrics.trimW) * PT_PER_MM;
        const bottom = metrics.trimY * PT_PER_MM;
        const top = (metrics.trimY + metrics.trimH) * PT_PER_MM;
        const lines = [
            [0, bottom, end, bottom],
            [pageW - end, bottom, pageW, bottom],
            [0, top, end, top],
            [pageW - end, top, pageW, top],
            [left, 0, left, end],
            [left, pageH - end, left, pageH],
            [right, 0, right, end],
            [right, pageH - end, right, pageH],
        ];
        return [
            'q',
            '0 0 0 1 K',
            '0.25 w',
            '1 J',
            '1 j',
            ...lines.map(([x1, y1, x2, y2]) => `${round(x1, 3)} ${round(y1, 3)} m ${round(x2, 3)} ${round(y2, 3)} l S`),
            'Q',
        ].join('\n');
    };

    /**
     * Die-cut path as vector strokes at trim, in magenta (0/100/0/0). It is a
     * cutting guide, not a spot colour; the printer's die-line stays
     * authoritative.
     */
    const cutOperations = (page) => {
        if (!page.shape) return '';
        const metrics = pageMetrics(page);
        const ptOf = (value) => round(value * PT_PER_MM, 3);
        const x0 = ptOf(metrics.trimX);
        const y0 = ptOf(metrics.trimY);
        const x1 = ptOf(metrics.trimX + metrics.trimW);
        const y1 = ptOf(metrics.trimY + metrics.trimH);
        const ops = [];
        if (page.shape === 'circle') {
            const cx = ptOf(metrics.trimX + metrics.trimW / 2);
            const cy = ptOf(metrics.trimY + metrics.trimH / 2);
            const radius = ptOf(Math.min(metrics.trimW, metrics.trimH) / 2);
            const k = round(radius * 0.5522847498, 3);
            ops.push(
                `${round(cx + radius, 3)} ${cy} m`,
                `${round(cx + radius, 3)} ${round(cy + k, 3)} ${round(cx + k, 3)} ${round(cy + radius, 3)} ${cx} ${round(cy + radius, 3)} c`,
                `${round(cx - k, 3)} ${round(cy + radius, 3)} ${round(cx - radius, 3)} ${round(cy + k, 3)} ${round(cx - radius, 3)} ${cy} c`,
                `${round(cx - radius, 3)} ${round(cy - k, 3)} ${round(cx - k, 3)} ${round(cy - radius, 3)} ${cx} ${round(cy - radius, 3)} c`,
                `${round(cx + k, 3)} ${round(cy - radius, 3)} ${round(cx + radius, 3)} ${round(cy - k, 3)} ${round(cx + radius, 3)} ${cy} c`,
            );
        } else {
            const r = Math.min(
                ptOf(Math.min(metrics.trimW, metrics.trimH) * (page.shape === 'sleeve' ? 0.02 : 0.05)),
                (x1 - x0) / 2,
                (y1 - y0) / 2,
            );
            const k = round(r * 0.5522847498, 3);
            const line = (x, y) => `${round(x, 3)} ${round(y, 3)} l`;
            const curve = (c1x, c1y, c2x, c2y, x, y) => `${round(c1x, 3)} ${round(c1y, 3)} ${round(c2x, 3)} ${round(c2y, 3)} ${round(x, 3)} ${round(y, 3)} c`;
            ops.push(
                `${round(x0 + r, 3)} ${y0} m`,
                line(x1 - r, y0),
                curve(x1 - r + k, y0, x1, y0 + r - k, x1, y0 + r),
                line(x1, y1 - r),
                curve(x1, y1 - r + k, x1 - r + k, y1, x1 - r, y1),
                line(x0 + r, y1),
                curve(x0 + r - k, y1, x0, y1 - r + k, x0, y1 - r),
                line(x0, y0 + r),
                curve(x0, y0 + r - k, x0 + r - k, y0, x0 + r, y0),
                'h',
            );
            if (page.shape === 'hanger') {
                const hole = Math.min(metrics.trimW * 0.42, metrics.trimH * 0.095);
                const hx = ptOf(metrics.trimX + metrics.trimW / 2);
                const hy = ptOf(metrics.trimY + metrics.trimH * 0.86);
                const hr = ptOf(hole);
                const hk = round(hr * 0.5522847498, 3);
                ops.push(
                    `${round(hx + hr, 3)} ${round(hy, 3)} m`,
                    `${round(hx + hr, 3)} ${round(hy + hk, 3)} ${round(hx + hk, 3)} ${round(hy + hr, 3)} ${round(hx, 3)} ${round(hy + hr, 3)} c`,
                    `${round(hx - hk, 3)} ${round(hy + hr, 3)} ${round(hx - hr, 3)} ${round(hy + hk, 3)} ${round(hx - hr, 3)} ${round(hy, 3)} c`,
                    `${round(hx - hr, 3)} ${round(hy - hk, 3)} ${round(hx - hk, 3)} ${round(hy - hr, 3)} ${round(hx, 3)} ${round(hy - hr, 3)} c`,
                    `${round(hx + hk, 3)} ${round(hy - hr, 3)} ${round(hx + hr, 3)} ${round(hy - hk, 3)} ${round(hx + hr, 3)} ${round(hy, 3)} c`,
                );
            }
        }
        return ['q', '0 1 0 0 K', '0.5 w', '1 J', '1 j', ...ops, 'S', 'Q'].join('\n');
    };

    const textBytes = (value) => new TextEncoder().encode(value);

    /**
     * Build the PDF. Each page is an image of the bleed box; the crop/trim
     * geometry is recorded in the page boxes and the marks are vector.
     */
    const buildPdf = async ({ pages, title = 'Asset Studio print pack', onProgress = null }) => {
        if (!Array.isArray(pages) || !pages.length) throw new Error('No print pages were supplied.');
        const objects = [];
        const pageIds = pages.map((_, index) => 3 + index * 3);
        const pageCount = pages.length;
        const totalObjects = 2 + pageCount * 3;

        const pageObjects = [];
        const imageObjects = [];
        const contentObjects = [];

        for (let index = 0; index < pageCount; index += 1) {
            const page = pages[index];
            const metrics = pageMetrics(page);
            const canvas = page.canvas;
            if (!canvas || !canvas.width || !canvas.height) throw new Error(`Page ${index + 1} has no image.`);
            if (onProgress) onProgress(index + 1, pageCount);
            await new Promise((resolve) => setTimeout(resolve, 0));
            const context = canvas.getContext('2d', { willReadFrequently: true });
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            const cmyk = cmykFromRgba(pixels.data, canvas.width, canvas.height);
            const compressed = await compress(cmyk);
            const stream = compressed || cmyk;
            const filter = compressed ? ' /Filter /FlateDecode' : '';
            const imageId = pageIds[index] + 1;
            const contentId = pageIds[index] + 2;

            const pageHead = [
                '<< /Type /Page',
                '/Parent 2 0 R',
                `/MediaBox [0 0 ${mm(metrics.mediaW)} ${mm(metrics.mediaH)}]`,
                `/BleedBox [${mm(metrics.bleedX)} ${mm(metrics.bleedY)} ${mm(metrics.bleedX + metrics.bleedW)} ${mm(metrics.bleedY + metrics.bleedH)}]`,
                `/TrimBox [${mm(metrics.trimX)} ${mm(metrics.trimY)} ${mm(metrics.trimX + metrics.trimW)} ${mm(metrics.trimY + metrics.trimH)}]`,
                `/CropBox [0 0 ${mm(metrics.mediaW)} ${mm(metrics.mediaH)}]`,
                `/Resources << /XObject << /Im0 ${imageId} 0 R >> >>`,
                `/Contents ${contentId} 0 R`,
                '>>',
            ].join(' ');

            const bleedWpt = metrics.bleedW * PT_PER_MM;
            const bleedHpt = metrics.bleedH * PT_PER_MM;
            const content = [
                'q',
                `${round(bleedWpt, 3)} 0 0 ${round(bleedHpt, 3)} ${mm(metrics.bleedX)} ${mm(metrics.bleedY)} cm`,
                '/Im0 Do',
                'Q',
                markOperations(page),
                cutOperations(page),
            ].filter(Boolean).join('\n');
            const contentBytes = textBytes(content);

            const imageHead = [
                '<< /Type /XObject',
                '/Subtype /Image',
                `/Width ${canvas.width}`,
                `/Height ${canvas.height}`,
                '/ColorSpace /DeviceCMYK',
                '/BitsPerComponent 8',
                `${filter}`.trim(),
                `/Length ${stream.length}`,
                '>>',
            ].filter(Boolean).join(' ');

            pageObjects.push({ head: pageHead });
            imageObjects.push({ head: imageHead, stream });
            contentObjects.push({ head: `<< /Length ${contentBytes.length} >>`, stream: contentBytes });
        }

        const kids = pageIds.map((id) => `${id} 0 R`).join(' ');
        objects.push({ head: '<< /Type /Catalog /Pages 2 0 R >>' });
        objects.push({ head: `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>` });
        for (let index = 0; index < pageCount; index += 1) {
            objects.push(pageObjects[index]);
            objects.push(imageObjects[index]);
            objects.push(contentObjects[index]);
        }
        if (objects.length !== totalObjects) throw new Error('The PDF object table is incomplete.');

        const chunks = [textBytes(`%PDF-1.4\n%${String.fromCharCode(0xE2, 0xE3, 0xCF, 0xD3)}\n`)];
        const offsets = [0];
        let cursor = chunks[0].length;
        objects.forEach((object, index) => {
            const objectId = index + 1;
            offsets[objectId] = cursor;
            const head = textBytes(`${objectId} 0 obj\n${object.head}`);
            chunks.push(head);
            cursor += head.length;
            if (object.stream) {
                const open = textBytes('\nstream\n');
                const close = textBytes('\nendstream\n');
                chunks.push(open, object.stream, close);
                cursor += open.length + object.stream.length + close.length;
            }
            const end = textBytes('\nendobj\n');
            chunks.push(end);
            cursor += end.length;
        });

        const xrefOffset = cursor;
        const xrefLines = ['xref', `0 ${totalObjects + 1}`, '0000000000 65535 f '];
        for (let id = 1; id <= totalObjects; id += 1) {
            xrefLines.push(`${String(offsets[id] || 0).padStart(10, '0')} 00000 n `);
        }
        const trailer = [
            xrefLines.join('\n'),
            'trailer',
            `<< /Size ${totalObjects + 1} /Root 1 0 R /Title (${String(title).replace(/[()\\]/g, '')}) >>`,
            'startxref',
            String(xrefOffset),
            '%%EOF',
            '',
        ].join('\n');
        chunks.push(textBytes(trailer));
        return new Blob(chunks, { type: 'application/pdf' });
    };

    window.AssetPrint = {
        PT_PER_MM,
        PRINT_SPECS,
        resolveSpec,
        canCompress,
        cmykFromRgba,
        checkBoxes,
        pageMetrics,
        cutOperations,
        buildPdf,
    };
})();
