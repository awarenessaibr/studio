'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PACK = path.resolve(__dirname, '..', '..', 'docs', 'agent-first-studio');
const cache = new Map();

function read(file) {
  return fs.readFileSync(path.join(PACK, file), 'utf8');
}

/**
 * Load the model-facing pack as a system prompt.
 * DeepSeek gets the full contract; local models get the compact schema prompt
 * so a small-context model is not buried under references it cannot use.
 */
function systemPrompt(provider = 'ollama') {
  const mode = provider === 'deepseek' ? 'full' : 'local';
  if (cache.has(mode)) return cache.get(mode);
  const files = mode === 'full'
    ? ['agent.md', '01-runtime-contract.md', '02-composition-editing.md', '03-animation-authoring.md', '04-workflows.md', '05-quality-gates.md', '07-glossary.md']
    : ['local-system-prompt.md'];
  const prompt = [
    'You are operating Agent First Studio. The following documentation pack is the authoritative contract.',
    'Return exactly one JSON object when handling a studio request; no markdown fence and no prose outside it.',
    'Never invent layer ids, clip ids, menu ids, facts, prices or content. The source recording is not editable; generated work uses the editable composition.',
    '',
    ...files.map((file) => `\n\n===== ${file} =====\n${read(file)}`),
  ].join('\n');
  cache.set(mode, prompt);
  return prompt;
}

function promptFiles(provider = 'ollama') {
  return provider === 'deepseek'
    ? ['agent.md', '01-runtime-contract.md', '02-composition-editing.md', '03-animation-authoring.md', '04-workflows.md', '05-quality-gates.md', '07-glossary.md']
    : ['local-system-prompt.md'];
}

module.exports = { systemPrompt, promptFiles, PACK };
