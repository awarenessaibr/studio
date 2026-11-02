'use strict';
/** Voice-design agent contract: exactly two complete, distinct directions. */
const test = require('node:test');
const assert = require('node:assert/strict');

const reply = (proposals) => async () => JSON.stringify({ proposals });

const raw = (direction, extra = {}) => ({
    direction,
    name: direction,
    description: `${direction} description.`,
    language: 'english',
    presentation: 'androgynous',
    age: 'adult',
    delivery: 'warm',
    sample: 'A calm line for the audition.',
    ...extra,
});

const context = {
    models: ['mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16'],
    languages: ['english', 'portuguese'],
};

test('the agent returns exactly two distinct complete proposals', async () => {
    const agent = await import('../src/server/voice/voice-design-agent.mjs');
    const result = await agent.generateProposals(reply([
        raw('Warm documentary'),
        raw('Bright editorial', { delivery: 'energetic', presentation: 'masculine' }),
    ]), { message: 'A warm English narrator', context });
    assert.equal(result.proposals.length, 2);
    assert.notEqual(result.proposals[0].direction, result.proposals[1].direction);
    for (const proposal of result.proposals) {
        assert.ok(proposal.instruct.includes('English'));
        assert.ok(proposal.sample);
        assert.ok(proposal.refine);
    }
});

test('the agent refuses to clone one proposal into two', async () => {
    const agent = await import('../src/server/voice/voice-design-agent.mjs');
    const one = raw('Warm documentary');
    await assert.rejects(
        () => agent.generateProposals(reply([one, { ...one }]), { message: 'same', context }),
        /two distinct/,
    );
});

test('the preview payload uses the composed instruct and sample', async () => {
    const agent = await import('../src/server/voice/voice-design-agent.mjs');
    const result = await agent.generateProposals(reply([
        raw('Warm documentary', { language: 'portuguese', locale: 'pt-BR', sample: 'Uma linha calma.' }),
        raw('Bright editorial', { language: 'portuguese', locale: 'pt-PT', sample: 'Uma linha brilhante.' }),
    ]), { message: 'Portuguese narrator', context });
    const payload = agent.proposalSpeechPayload(result.proposals[0]);
    assert.equal(payload.model, context.models[0]);
    assert.equal(payload.input, 'Uma linha calma.');
    assert.ok(payload.instruct.includes('Brazilian Portuguese'));
    assert.equal(payload.response_format, 'wav');
});
