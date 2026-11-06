'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const server = require('../server.js');

function pngHeader(width, height) {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(png);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(width, 16);
    png.writeUInt32BE(height, 20);
    return png;
}

function storedZip(files) {
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;

    files.forEach(({ name, data }) => {
        const nameBytes = Buffer.from(name);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034B50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        localParts.push(local, nameBytes, data);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014B50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBytes.length, 28);
        central.writeUInt32LE(localOffset, 42);
        centralParts.push(central, nameBytes);
        localOffset += local.length + nameBytes.length + data.length;
    });

    const centralDirectory = Buffer.concat(centralParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054B50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralDirectory.length, 12);
    end.writeUInt32LE(localOffset, 16);
    return Buffer.concat([...localParts, centralDirectory, end]);
}

test('ZIP import restores named segment groups from the segmentation manifest', async (t) => {
    let importedId = '';
    t.after(async () => {
        if (importedId) {
            await fs.rm(path.join(__dirname, '..', 'data', 'imports', importedId), {
                recursive: true,
                force: true,
            });
        }
    });

    const image = pngHeader(1, 1);
    const filename = 'scones_scones-blueberry-coconut.png';
    const manifest = Buffer.from(JSON.stringify({
        schema: 'image-to-layers/segments-v1',
        layers: [{
            file: filename,
            name: 'scones-blueberry-coconut',
            group: 'Scones',
            role: 'prop',
            label: 'Blueberry coconut scone',
            description: 'A scone topped with blueberries and coconut.',
        }],
    }));
    const zip = storedZip([
        { name: filename, data: image },
        { name: 'image-to-layers.json', data: manifest },
    ]);

    const result = await server.createImport({
        zip: zip.toString('base64'),
        zipName: 'bakery.zip',
        reference: `data:image/png;base64,${image.toString('base64')}`,
        referenceName: 'bakery.png',
        name: 'Bakery scene',
    });
    importedId = result.project.id;

    const layer = result.composition.layers.find((entry) => entry.id !== 'reference');
    assert.equal(layer.name, 'scones-blueberry-coconut');
    assert.equal(layer.segmentGroup, 'Scones');
    assert.equal(layer.role, 'prop');
    assert.equal(layer.label, 'Blueberry coconut scone');
    assert.equal(layer.description, 'A scone topped with blueberries and coconut.');
});
