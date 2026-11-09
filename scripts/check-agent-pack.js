#!/usr/bin/env node
/** Lint the Agent First documentation pack manifest, links and examples. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PACK = path.join(ROOT, 'docs', 'agent-first-studio');
const manifest = JSON.parse(fs.readFileSync(path.join(PACK, 'pack.json'), 'utf8'));
let failed = 0;
const check = (condition, message) => {
  if (condition) return;
  failed++;
  console.error('FAIL', message);
};
const exists = (file) => {
  const full = path.resolve(PACK, file);
  check(full.startsWith(PACK + path.sep) && fs.existsSync(full), `missing or escaping path: ${file}`);
  return fs.existsSync(full);
};
for (const file of [manifest.entrypoint, manifest.skill, manifest.systemPromptFile, ...(manifest.references || []), ...(manifest.examples || [])]) exists(file);
for (const file of manifest.examples || []) {
  if (!exists(file)) continue;
  try {
    const value = JSON.parse(fs.readFileSync(path.join(PACK, file), 'utf8'));
    check(typeof value.reply === 'string', `${file} has no reply string`);
  } catch (error) {
    check(false, `${file} is not valid JSON: ${error.message}`);
  }
}
const skill = fs.readFileSync(path.join(PACK, manifest.skill), 'utf8');
check(/entrypoint:\s*"agent\.md"/.test(skill), 'SKILL.md entrypoint must be agent.md');
const agent = fs.readFileSync(path.join(PACK, manifest.entrypoint), 'utf8');
for (const needle of ['Unit invariant', 'Mandatory pre-flight', 'Original motion has no editable tracks', 'is gated', 'sx/sy']) {
  check(agent.includes(needle), `agent.md missing: ${needle}`);
}
if (failed) {
  console.error(`Agent pack check failed (${failed} issue${failed === 1 ? '' : 's'}).`);
  process.exit(1);
}
console.log(`Agent pack OK: ${manifest.version}, ${manifest.references.length} references, ${manifest.examples.length} examples.`);
