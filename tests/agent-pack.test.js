'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACK = path.join(ROOT, 'docs', 'agent-first-studio');
const pack = JSON.parse(fs.readFileSync(path.join(PACK, 'pack.json'), 'utf8'));

test('the Agent First documentation pack is complete and internally linked', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'agent.md')));
  assert.equal(pack.entrypoint, 'agent.md');
  for (const file of [pack.entrypoint, pack.skill, ...pack.references, ...pack.examples]) {
    assert.ok(fs.existsSync(path.join(PACK, file)), `${file} exists`);
  }
  const agent = fs.readFileSync(path.join(PACK, 'agent.md'), 'utf8');
  for (const channel of ['reply', 'animation', 'steps', 'composition_fixes', 'new_composition', 'review']) {
    assert.ok(agent.includes(`\`${channel}\``), `agent.md documents ${channel}`);
  }
  assert.match(agent, /one JSON object/i);
  assert.match(agent, /Never invent/i);
  assert.match(agent, /Menu item card/i);
});

test('every response example is valid JSON with a reply', () => {
  for (const file of pack.examples) {
    const value = JSON.parse(fs.readFileSync(path.join(PACK, file), 'utf8'));
    assert.equal(typeof value.reply, 'string');
  }
});

test('the skills crosswalk records relevant and excluded skills', () => {
  const text = fs.readFileSync(path.join(PACK, '06-skills-crosswalk.md'), 'utf8');
  for (const skill of ['design-ui', 'game-animation-frames', 'imagine-grok-build']) {
    assert.ok(text.includes(skill), `${skill} is mapped`);
  }
  for (const skill of ['auth', 'building-games', 'controls', 'threejs']) {
    assert.ok(text.includes(skill), `${skill} is deliberately excluded`);
  }
});
