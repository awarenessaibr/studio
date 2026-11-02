'use strict';
/** Social-intelligence contract: normalise scraped evidence; never invent it. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Intel = require('../src/server/social-intel.js');

const profile = {
    business: { name: 'The Physician', slug: 'thephysician-bar', category: 'Bar', city: 'St Andrews', website: 'https://example.com' },
    social: {
        matrix: [
            { source: 'instagram', label: 'Instagram', present: true, handle: 'thephysician_standrews', followers: 1794, posts: 342, bio: 'Cocktails', posts_collected: 9, mode: 'web-public', warnings: [] },
            { source: 'facebook', label: 'Facebook', present: true, followers: null, warnings: ['profile partial'] },
        ],
        totals: { followers: 1794, platforms_present: 2, platforms_configured: 2 },
        completeness: { instagram: 0.6, facebook: 0.2 },
        handle_consistency: 0,
        gaps: ['tiktok', 'youtube'],
        content_mix: { post: { count: 9, share: 1 } },
    },
    reputation: {
        consensus_rating: 3.7,
        total_reviews: 65,
        collected_reviews: 5,
        sources: { google: { label: 'Google Maps', rating: 3.7, count: 65, collected: 5, warnings: [] } },
        distribution: { 5: 36, 4: 6, 3: 4, 2: 6, 1: 13 },
        sentiment: { positive: 3, neutral: 1, negative: 1, positive_share: 0.6, negative_share: 0.2 },
        owner_response_rate: 0.4,
        themes: {
            'food quality': {
                mentions: 2, positive: 0, negative: 1, neutral: 1, net_sentiment: -0.5,
                samples: [{ rating: 2, source: 'google', snippet: 'The food was cold.' }],
            },
        },
        notable: {
            best: [{ author: 'Guest', rating: 5, source: 'google', text: 'Great cocktails.', date: '2026-09-02' }],
            worst: [{ author: 'Guest', rating: 1, source: 'google', text: 'The food was cold.', date: '2026-04-03' }],
        },
    },
    signals: { strengths: ['A real audience'], weaknesses: [], opportunities: ['Reply to reviews'], risks: [] },
    scores: { overall: 52.3, reputation: 53.1 },
    web: { has_online_booking: false },
};

test('normalises channels, reputation, themes and voice evidence', () => {
    const dataset = Intel.normaliseProfile(profile, {
        tokens: { voice: { samples: ['A calm line.'], topKeywords: ['drinks', 'service'] } },
    });
    assert.equal(dataset.business.name, 'The Physician');
    assert.equal(dataset.channels.length, 2);
    assert.equal(dataset.totals.followers, 1794);
    assert.equal(dataset.reputation.rating, 3.7);
    assert.equal(dataset.reputation.themes[0].name, 'food quality');
    assert.equal(dataset.voice.keywords[0], 'drinks');
    assert.equal(dataset.voice.samples[0], 'A calm line.');
    assert.ok(dataset.intelligence.actions.some((action) => action.code === 'NEGATIVE_THEME'));
});

test('keeps the full review list when it is present in the reputation payload', () => {
    const reviewA = { author: 'A', rating: 5, source: 'google', text: 'Great cocktails.', date: '2026-09-02' };
    const reviewB = { author: 'B', rating: 2, source: 'google', text: 'Too loud.', date: '2026-05-03' };
    const dataset = Intel.normaliseProfile({
        ...profile,
        reputation: {
            ...profile.reputation,
            reviews: [reviewA, reviewB],
            notable: { best: [reviewA], worst: [reviewB] },
        },
    }, { tokens: { voice: { samples: ['A calm line.'], topKeywords: ['drinks', 'service'] } } });
    assert.equal(dataset.reputation.reviews.length, 2);
    assert.equal(dataset.reputation.best.length, 1);
    assert.equal(dataset.reputation.worst.length, 1);
});

test('an empty profile is honest, not a zero-star business', () => {
    const dataset = Intel.normaliseProfile({ business: { name: 'Empty' }, social: {}, reputation: {} });
    assert.equal(dataset.reputation.rating, null);
    assert.equal(dataset.intelligence.tone, 'empty');
    assert.match(dataset.intelligence.summary, /did not return/i);
});

test('the brand matcher handles slug and display-name drift', () => {
    const dataset = Intel.normaliseProfile(profile, { id: 'soc_123456789012' });
    assert.ok(Intel.matchBrand({ id: 'the-physician', name: 'The Physician' }, dataset) >= 90);
    assert.ok(Intel.matchBrand({ id: 'thephysician-bar', name: 'The Physician Bar' }, dataset) >= 90);
    assert.ok(Intel.matchBrand({ id: 'okja', name: 'Okja' }, dataset) < 70);
});

test('a thin sample is labelled as thin even when the rating is good', () => {
    const dataset = Intel.normaliseProfile({
        ...profile,
        reputation: { ...profile.reputation, consensus_rating: 4.5, total_reviews: 1200, collected_reviews: 5 },
        social: { ...profile.social, gaps: [] },
    });
    assert.ok(dataset.intelligence.actions.some((action) => action.code === 'THIN_REVIEW_DEPTH'));
    assert.ok(dataset.intelligence.summary.length > 10);
});
