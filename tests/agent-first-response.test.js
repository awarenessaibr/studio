'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normaliseAgentFirstResponse, requestedAnimationDuration } = require('../server.js');

test('a restyle request cannot silently create a new composition', () => {
  const response = JSON.stringify({
    reply: 'I restyled it.',
    new_composition: { name: 'Restyle', layers: [] },
  });
  const parsed = JSON.parse(normaliseAgentFirstResponse(response, [{ role: 'user', content: 'Restyle this design.' }]));
  assert.equal(parsed.new_composition, undefined);
  assert.match(parsed.reply, /explicitly/i);
});

test('a new-composition trigger is allowed', () => {
  const response = JSON.stringify({
    reply: 'I made a version.',
    new_composition: { name: 'Version', layers: [] },
  });
  const parsed = JSON.parse(normaliseAgentFirstResponse(response, [{ role: 'user', content: 'Create a new composition.' }]));
  assert.ok(parsed.new_composition);
});

test('an explicit requested duration is applied to the animation', () => {
  assert.equal(requestedAnimationDuration([{ role: 'user', content: 'Make a 5 second animation.' }]), 5000);
  assert.equal(requestedAnimationDuration([{ role: 'user', content: 'Make a 5000 ms animation.' }]), 5000);
  assert.equal(requestedAnimationDuration([{ role: 'user', content: 'Make the entrance 1400 ms long.' }]), null);
  const response = JSON.stringify({ reply: 'ok', animation: { name: 'x', duration: 1000, tracks: [{ layerId: 'a', segments: [] }] } });
  const parsed = JSON.parse(normaliseAgentFirstResponse(response, [{ role: 'user', content: 'Make a 5 second animation.' }]));
  assert.equal(parsed.animation.duration, 5000);
});
