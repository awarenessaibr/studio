'use strict';
/**
 * Crawler intake service checks that do not touch the network.
 *
 * The full crawl is exercised manually and by tests/asset-studio.js after an
 * import; these checks cover the API safety rails around it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Crawler = require('../crawler-service.js');

test('crawler status exposes a usable Python/Playwright contract', async () => {
    const status = await Crawler.status();
    assert.equal(typeof status.available, 'boolean');
    assert.equal(typeof status.script, 'boolean');
    assert.equal(typeof status.playwright, 'boolean');
    if (status.available) {
        assert.ok(status.pythonVersion, 'pythonVersion is reported');
        assert.ok(status.python, 'python executable is reported');
    }
});

test('search rejects an empty business name before spawning Python', async () => {
    await assert.rejects(() => Crawler.search({ query: ' ' }), /Business name|two characters/i);
    await assert.rejects(() => Crawler.search({ query: 'A' }), /two characters/i);
});

test('discover rejects private and non-http targets', async () => {
    await assert.rejects(
        () => Crawler.discover({ website: 'http://127.0.0.1:8008/' }),
        /private|Internal|not allowed/i,
    );
    await assert.rejects(
        () => Crawler.discover({ website: 'file:///etc/passwd' }),
        /http|https/i,
    );
});

test('startRun requires a name, website and safe options', async () => {
    await assert.rejects(() => Crawler.startRun({ target: { name: '', website: 'https://example.com' } }), /name/i);
    await assert.rejects(() => Crawler.startRun({ target: { name: 'Test', website: 'http://localhost/' } }), /private|Internal|not allowed/i);
});

test('a group is bounded and requires at least one restaurant', async () => {
    await assert.rejects(() => Crawler.startRun({ targets: [] }), /At least one restaurant/i);
    const tooMany = Array.from({ length: 13 }, (_, index) => ({
        name: `Restaurant ${index + 1}`,
        website: `https://example.com/${index + 1}`,
    }));
    await assert.rejects(() => Crawler.startRun({ targets: tooMany, group: 'Too big' }), /at most 12/i);
});

test('long Google Maps profile URLs are accepted for a group target', () => {
    const google = `https://www.google.com/maps/place/Test/@1,2,17z/data=!4m8!3m7!1s${'x'.repeat(900)}`;
    const targets = Crawler.cleanTargets({
        target: {
            name: 'Long URL Restaurant',
            website: 'https://example.com/',
            profiles: { google },
        },
    });
    assert.equal(targets.length, 1);
    assert.equal(targets[0].profiles.google, google);
});

test('unknown run ids are rejected', async () => {
    await assert.rejects(() => Crawler.getRun('../etc/passwd'), /Invalid run id/i);
    await assert.rejects(() => Crawler.cancelRun('missing-run'), /not active/i);
});
