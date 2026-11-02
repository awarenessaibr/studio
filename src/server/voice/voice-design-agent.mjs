/* Voice-design agent: turn a sentence into exactly two complete, distinct voice
 * recipes — and remember them for the user who asked.
 *
 * The TTS page's voice-design form has ~30 controls. Asking a user to translate
 * "warm documentary narrator, Brazilian Portuguese" into rate/pitch/timbre values
 * is unreasonable, so this module calls the engine with a strict JSON contract
 * and returns two directions. Both are *complete* recipes: every select, every
 * slider and the model-specific params, plus the composed `instruct` string that
 * MLX-Audio actually receives.
 *
 * Two invariants are enforced here rather than trusted to the model:
 *   1. exactly two proposals, distinct in direction and settings;
 *   2. every value is valid for the form (enums and ranges), so "Apply" always
 *      fills the form instead of silently writing an invalid option.
 *
 * Persistence is per user (`x-oia-user`, defaulting to the local identity) and
 * survives restarts: sessions live under `.state/voice-design-agent/<user>/`.
 * That is the "persistent for that user" requirement; when real auth arrives the
 * same header is the only thing that needs to change.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './tts-config.mjs';

const MAX_SESSIONS = 60;
const MAX_MESSAGES = 80;
const MAX_PROPOSALS = 120;
const MAX_MESSAGE_CHARS = 2000;
const MAX_DESCRIPTION_CHARS = 1200;
const MAX_SAMPLE_CHARS = 600;
const MAX_REFERENCE_TEXT_CHARS = 1200;
const MAX_ACCENT_CHARS = 120;
const MAX_NAME_CHARS = 80;
const MAX_PARAMS_KEYS = 24;

export const FALLBACK_MODEL = 'mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16';

const PRESENTATIONS = ['unspecified', 'feminine', 'masculine', 'androgynous'];
const AGES = ['unspecified', 'youthful', 'adult', 'mature'];
const DELIVERIES = ['natural', 'calm', 'energetic', 'formal', 'warm'];
const PAUSES = ['natural', 'tight', 'measured', 'dramatic'];
const REGISTERS = ['unspecified', 'very-low', 'low', 'mid-low', 'mid', 'mid-high', 'high'];
const EMOTIONS = ['neutral', 'warm', 'calm', 'mischievous', 'worried', 'sad', 'grieving', 'cheerful', 'stern', 'hollow'];
const ARCS = ['flat', 'build', 'fall', 'suspense-slowdown', 'gradually-softer'];
const ARTICULATIONS = ['natural', 'crisp', 'relaxed', 'slurred'];
const SPACES = ['dry', 'room', 'hall', 'cave', 'outdoor', 'telephone'];
const PROXIMITIES = ['close', 'mid', 'far', 'distant'];
const ENSEMBLES = ['solo', 'duo', 'trio', 'chorus', 'layered'];
const QWEN_LANGUAGES = [
  'auto', 'chinese', 'czech', 'english', 'german', 'greek', 'italian', 'japanese',
  'korean', 'polish', 'portuguese', 'slovak', 'spanish', 'french', 'russian',
];
const LOCALE_LANGUAGES = ['czech', 'english', 'greek', 'polish', 'portuguese', 'slovak'];

const ENUM_ALIASES = {
  presentation: {
    male: 'masculine', man: 'masculine', female: 'feminine', woman: 'feminine',
    nonbinary: 'androgynous', 'non-binary': 'androgynous', neutral: 'androgynous',
  },
  age: {
    young: 'youthful', child: 'youthful', teenage: 'youthful',
    'middle-aged': 'adult', middleaged: 'adult', grown: 'adult',
    old: 'mature', elderly: 'mature', senior: 'mature',
  },
  delivery: {
    conversational: 'natural', neutral: 'natural',
    soothing: 'warm', reassuring: 'warm', gentle: 'warm',
    measured: 'calm', slow: 'calm', relaxed: 'calm',
    expressive: 'energetic', lively: 'energetic', excited: 'energetic',
    professional: 'formal', deliberate: 'formal', serious: 'formal',
  },
  pause: { none: 'tight', short: 'tight', even: 'measured', long: 'dramatic', cinematic: 'dramatic' },
  register: {
    bass: 'very-low', baritone: 'low', deep: 'low', alto: 'mid-low',
    tenor: 'mid-high', treble: 'high', soprano: 'high',
  },
  emotion: {
    happy: 'cheerful', joyful: 'cheerful', angry: 'stern', firm: 'stern',
    melancholy: 'sad', sorrowful: 'sad', somber: 'grieving', heartbroken: 'grieving',
    playful: 'mischievous', anxious: 'worried', flat: 'hollow', empty: 'hollow',
    kind: 'warm', comforting: 'warm',
  },
  arc: {
    rising: 'build', climax: 'build', fade: 'fall', softening: 'gradually-softer',
    soothing: 'gradually-softer', suspense: 'suspense-slowdown', slowdown: 'suspense-slowdown',
  },
  articulation: {
    precise: 'crisp', clear: 'crisp', sharp: 'crisp', conversational: 'natural',
    loose: 'relaxed', mumble: 'slurred', mumbled: 'slurred',
  },
  space: {
    studio: 'dry', dry: 'dry', chamber: 'room', cathedral: 'hall', church: 'hall',
    outside: 'outdoor', exterior: 'outdoor', phone: 'telephone', radio: 'telephone',
    'lo-fi': 'telephone', lofi: 'telephone', cave: 'cave', chimney: 'cave',
  },
  proximity: {
    intimate: 'close', near: 'close', closeup: 'close', normal: 'mid',
    distant: 'distant', faraway: 'far', far: 'far',
  },
  ensemble: {
    single: 'solo', one: 'solo', two: 'duo', double: 'duo', three: 'trio',
    group: 'chorus', crowd: 'chorus', stack: 'layered',
  },
};

function str(value, max = 2000) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, '').trim().slice(0, max);
}

function num(value, fallback, min, max) {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function int(value, fallback, min, max) {
  return Math.round(num(value, fallback, min, max));
}

/** Snap to the HTML range input's step so the form shows exactly what we stored. */
function snap(value, fallback, min, max, step) {
  const n = num(value, fallback, min, max);
  const snapped = Math.round(n / step) * step;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(6))));
}

function pick(value, allowed, fallback) {
  const raw = String(value || '').trim().toLowerCase();
  if (allowed.includes(raw)) return raw;
  return fallback;
}

function pickWithAlias(value, allowed, aliasKey, fallback) {
  const raw = String(value || '').trim().toLowerCase();
  if (allowed.includes(raw)) return raw;
  const alias = ENUM_ALIASES[aliasKey]?.[raw];
  if (alias && allowed.includes(alias)) return alias;
  return fallback;
}

/** A compact, model-facing description of the form contract. */
const OUTPUT_SCHEMA = `{
  "proposals": [
    {
      "direction": "2-4 word label for this direction, e.g. 'Grounded documentary'",
      "name": "recipe name, max 80 chars",
      "model": "one of AVAILABLE_MODELS (keep CURRENT_FORM.model unless the user asks otherwise)",
      "language": "one of CURRENT_FORM.languages, or auto / model default",
      "locale": "only for english/czech/greek/polish/portuguese/slovak; e.g. pt-BR, en-GB; otherwise ''",
      "accent": "free text, e.g. 'Brazilian Portuguese, São Paulo accent'; may be ''",
      "presentation": "unspecified|feminine|masculine|androgynous",
      "age": "unspecified|youthful|adult|mature",
      "delivery": "natural|calm|energetic|formal|warm",
      "description": "1-2 sentence voice description in English (this becomes the Voice description field)",
      "sample": "1-2 sentence preview text in the voice's language",
      "reference_text": "exact transcript of a user-supplied reference recording, else ''",
      "refine": {
        "rate": 0.5-2.0, "pitch": -12..12, "energy": 0..1,
        "pause": "natural|tight|measured|dramatic",
        "register": "unspecified|very-low|low|mid-low|mid|mid-high|high",
        "brightness": 0..1, "nasality": 0..1, "breathiness": 0..1, "rasp": 0..1,
        "emotion": "neutral|warm|calm|mischievous|worried|sad|grieving|cheerful|stern|hollow",
        "emotion_intensity": 0..1,
        "arc": "flat|build|fall|suspense-slowdown|gradually-softer",
        "articulation": "natural|crisp|relaxed|slurred",
        "space": "dry|room|hall|cave|outdoor|telephone",
        "reverb": 0..1, "echo": 0..600,
        "proximity": "close|mid|far|distant",
        "ensemble": "solo|duo|trio|chorus|layered",
        "ensemble_count": 1..8, "pan": -1..1,
        "params": {}
      },
      "rationale": "1-2 sentences on why this direction fits the request",
      "changes": ["2-4 short 'what to listen for' bullets"]
    }
  ]
}`;

function languagesFor(model, context) {
  const supplied = Array.isArray(context?.languages)
    ? context.languages.map((item) => (typeof item === 'string' ? item : item?.code)).filter(Boolean)
    : [];
  if (supplied.length) return supplied.map(String);
  if (/qwen3-tts/i.test(String(model || ''))) return QWEN_LANGUAGES;
  if (/kokoro/i.test(String(model || ''))) return ['a', 'b', 'e', 'f', 'h', 'i', 'p', 'j', 'z'];
  return [''];
}

function normalizeLanguage(value, model, context) {
  const allowed = languagesFor(model, context);
  const raw = String(value || '').trim().toLowerCase();
  if (allowed.includes(raw)) return raw;
  if (!raw) return allowed.includes('auto') ? 'auto' : (allowed[0] || '');
  if (allowed.includes('auto')) return 'auto';
  return allowed[0] || '';
}

function normalizeLocale(value, language) {
  if (!LOCALE_LANGUAGES.includes(language)) return '';
  const raw = str(value, 20);
  if (/^[a-z]{2}-[A-Z]{2}$/.test(raw)) return raw;
  const known = {
    english: 'en-US', portuguese: 'pt-BR', czech: 'cs-CZ', greek: 'el-GR',
    polish: 'pl-PL', slovak: 'sk-SK',
  };
  return known[language] || '';
}

function normalizeParams(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, raw] of Object.entries(value).slice(0, MAX_PARAMS_KEYS)) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(key)) continue;
    if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = raw;
    else if (typeof raw === 'boolean') out[key] = raw;
    else if (typeof raw === 'string' && raw.length <= 200) out[key] = raw;
  }
  return out;
}

/**
 * Compose the `instruct` string exactly the way the TTS page does. The page
 * recomposes it on save, so matching it here means the agent's preview and the
 * saved pack describe the same voice.
 */
export function composeInstruct(proposal) {
  const refine = proposal.refine || {};
  const clauses = [];
  const language = String(proposal.language || '');
  if (proposal.accent) clauses.push(`Use this accent or language variety: ${proposal.accent}.`);
  if (language === 'portuguese') {
    clauses.push(proposal.locale === 'pt-PT'
      ? 'Use European Portuguese pronunciation and vocabulary.'
      : 'Use Brazilian Portuguese pronunciation and vocabulary.');
  } else if (['czech', 'greek', 'polish', 'slovak'].includes(language) && proposal.locale) {
    clauses.push(`Use ${language} (${proposal.locale}) pronunciation and vocabulary.`);
  } else if (language === 'english' && proposal.locale) {
    const variant = {
      'en-US': 'American', 'en-GB': 'British', 'en-AU': 'Australian',
      'en-CA': 'Canadian', 'en-IN': 'Indian', 'en-IE': 'Irish',
      'en-NZ': 'New Zealand', 'en-ZA': 'South African', 'en-JM': 'Jamaican',
      'en-SG': 'Singaporean', 'en-NG': 'Nigerian',
    }[proposal.locale];
    if (variant) clauses.push(`Use ${variant} English pronunciation and vocabulary.`);
  } else if (language && language !== 'auto') {
    clauses.push(`Speak in ${language}.`);
  }

  if (proposal.presentation && proposal.presentation !== 'unspecified') {
    clauses.push(`Use a ${proposal.presentation} voice presentation.`);
  }
  if (proposal.age && proposal.age !== 'unspecified') clauses.push(`Sound ${proposal.age}.`);
  if (proposal.delivery) clauses.push(`Use ${proposal.delivery.replace('-', ' ')} delivery.`);
  if (proposal.description) clauses.push(proposal.description);

  if (refine.register && refine.register !== 'unspecified') {
    clauses.push(`Use a ${refine.register.replace('-', ' ')} voice register.`);
  }
  if (refine.rate < 0.95) clauses.push(`Speak slowly (rate ${refine.rate.toFixed(2)}×).`);
  else if (refine.rate > 1.05) clauses.push(`Speak briskly (rate ${refine.rate.toFixed(2)}×).`);
  if (refine.pitch !== 0) {
    clauses.push(`Shift pitch ${refine.pitch > 0 ? 'up' : 'down'} ${Math.abs(refine.pitch)} semitones.`);
  }
  if (refine.energy > 0.6) clauses.push('Project with strong energy.');
  else if (refine.energy < 0.4) clauses.push('Keep the delivery quiet and restrained.');
  if (refine.pause === 'dramatic') clauses.push('Use long dramatic pauses.');
  else if (refine.pause === 'tight') clauses.push('Keep pauses tight.');
  else if (refine.pause === 'measured') clauses.push('Use measured, even pauses.');
  if (refine.brightness > 0.65) clauses.push('Bright, forward tone.');
  else if (refine.brightness < 0.35) clauses.push('Dark, warm tone.');
  if (refine.nasality > 0.3) clauses.push('Slight nasal resonance.');
  if (refine.breathiness > 0.3) clauses.push('Breathy, intimate delivery.');
  if (refine.rasp > 0.3) clauses.push('Light vocal rasp.');
  if (refine.emotion !== 'neutral') {
    clauses.push(`Base emotion: ${refine.emotion} (intensity ${refine.emotion_intensity.toFixed(2)}).`);
  }
  if (refine.arc === 'suspense-slowdown') clauses.push('Slow down and lower the voice in suspense.');
  else if (refine.arc === 'gradually-softer') clauses.push('Gradually soften toward the end.');
  else if (refine.arc === 'build') clauses.push('Build intensity toward the end.');
  else if (refine.arc === 'fall') clauses.push('Start intense, then fall away.');
  if (refine.articulation === 'crisp') clauses.push('Crisp, precise articulation.');
  else if (refine.articulation === 'relaxed') clauses.push('Relaxed, conversational articulation.');
  else if (refine.articulation === 'slurred') clauses.push('Slurred, loose articulation.');
  if (refine.space !== 'dry') clauses.push(`Place the voice in a ${refine.space}.`);
  if (refine.reverb > 0.05) clauses.push(`Add reverb (${refine.reverb.toFixed(2)}).`);
  if (refine.echo > 0) clauses.push(`Add echo/delay around ${refine.echo} ms.`);
  if (refine.proximity !== 'mid') clauses.push(`The voice sounds ${refine.proximity}.`);
  if (refine.ensemble !== 'solo') clauses.push(`${refine.ensemble} of ${refine.ensemble_count} voices.`);
  if (refine.pan !== 0) clauses.push(`Pan ${refine.pan < 0 ? 'left' : 'right'} ${Math.abs(refine.pan).toFixed(1)}.`);
  return clauses.join(' ');
}

/**
 * Validate and clamp one model-produced proposal into the form's exact shape.
 * `context` carries what the client actually offers: `models`, `languages`,
 * `current` (the current form) and the user's message.
 */
export function normalizeProposal(input, context = {}, index = 0) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const refineRaw = raw.refine && typeof raw.refine === 'object' && !Array.isArray(raw.refine) ? raw.refine : {};

  const models = Array.isArray(context.models) ? context.models.map(String).filter(Boolean) : [];
  const current = context.current && typeof context.current === 'object' ? context.current : {};
  const requestedModel = str(raw.model, 200);
  const model = models.includes(requestedModel)
    ? requestedModel
    : (models.includes(str(current.model, 200)) ? str(current.model, 200) : (models[0] || FALLBACK_MODEL));

  const language = normalizeLanguage(raw.language ?? current.language, model, context);
  const locale = normalizeLocale(raw.locale, language);

  const description = str(raw.description ?? raw.instruct, MAX_DESCRIPTION_CHARS)
    || 'A natural, clear voice with comfortable pacing.';
  const name = str(raw.name, MAX_NAME_CHARS)
    || (str(raw.direction, 40) ? `${str(raw.direction, 40)} voice` : `Voice direction ${index + 1}`);
  const sample = str(raw.sample, MAX_SAMPLE_CHARS)
    || (language === 'portuguese'
      ? 'Uma voz calma pode tornar uma história complicada mais fácil de acompanhar.'
      : 'A calm voice can make a complicated story easier to follow.');

  const refine = {
    rate: snap(refineRaw.rate, 1, 0.5, 2, 0.05),
    pitch: int(refineRaw.pitch, 0, -12, 12),
    energy: snap(refineRaw.energy, 0.5, 0, 1, 0.05),
    pause: pickWithAlias(refineRaw.pause, PAUSES, 'pause', 'natural'),
    register: pickWithAlias(refineRaw.register, REGISTERS, 'register', 'unspecified'),
    brightness: snap(refineRaw.brightness, 0.5, 0, 1, 0.05),
    nasality: snap(refineRaw.nasality, 0, 0, 1, 0.05),
    breathiness: snap(refineRaw.breathiness, 0, 0, 1, 0.05),
    rasp: snap(refineRaw.rasp, 0, 0, 1, 0.05),
    emotion: pickWithAlias(refineRaw.emotion, EMOTIONS, 'emotion', 'neutral'),
    emotion_intensity: snap(refineRaw.emotion_intensity ?? refineRaw.emotionIntensity, 0.5, 0, 1, 0.05),
    arc: pickWithAlias(refineRaw.arc, ARCS, 'arc', 'flat'),
    articulation: pickWithAlias(refineRaw.articulation, ARTICULATIONS, 'articulation', 'natural'),
    space: pickWithAlias(refineRaw.space, SPACES, 'space', 'dry'),
    reverb: snap(refineRaw.reverb, 0, 0, 1, 0.05),
    echo: snap(refineRaw.echo ?? refineRaw.echo_ms, 0, 0, 600, 10),
    proximity: pickWithAlias(refineRaw.proximity, PROXIMITIES, 'proximity', 'mid'),
    ensemble: pickWithAlias(refineRaw.ensemble, ENSEMBLES, 'ensemble', 'solo'),
    ensemble_count: int(refineRaw.ensemble_count ?? refineRaw.ensembleCount, 1, 1, 8),
    pan: snap(refineRaw.pan, 0, -1, 1, 0.1),
    params: normalizeParams(refineRaw.params),
  };

  const proposal = {
    id: `vdp-${randomUUID()}`,
    direction: str(raw.direction, 60) || (name.length > 40 ? `${name.slice(0, 37)}…` : name),
    name,
    model,
    language,
    locale,
    accent: str(raw.accent, MAX_ACCENT_CHARS),
    presentation: pickWithAlias(raw.presentation, PRESENTATIONS, 'presentation', 'unspecified'),
    age: pickWithAlias(raw.age, AGES, 'age', 'unspecified'),
    delivery: pickWithAlias(raw.delivery, DELIVERIES, 'delivery', 'natural'),
    description,
    sample,
    reference_text: str(raw.reference_text ?? raw.referenceText, MAX_REFERENCE_TEXT_CHARS),
    refine,
    rationale: str(raw.rationale, 700) || 'A complete direction built from the request.',
    changes: Array.isArray(raw.changes)
      ? raw.changes.map((item) => str(item, 120)).filter(Boolean).slice(0, 5)
      : [],
    created_at: new Date().toISOString(),
    applied_at: null,
  };
  proposal.instruct = composeInstruct(proposal);
  return proposal;
}

/** A stable identity for de-duplication: two "different" proposals must differ. */
function proposalSignature(proposal) {
  return JSON.stringify([
    proposal.direction.toLowerCase(),
    proposal.model, proposal.language, proposal.locale, proposal.accent,
    proposal.presentation, proposal.age, proposal.delivery,
    proposal.description.toLowerCase(),
    proposal.refine,
  ]);
}

/** Similar enough to be the same direction, even if the prose differs. */
function sameDirection(a, b) {
  const label = (p) => String(p.direction || p.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return label(a) === label(b);
}

function extractJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const tryParse = (s) => {
    try { return JSON.parse(s); } catch { return undefined; }
  };
  const direct = tryParse(candidate);
  if (direct !== undefined) return direct;

  // Slice the first balanced object/array out of surrounding prose.
  for (const [open, close] of [['{', '}'], ['[', ']']]) {
    const start = candidate.indexOf(open);
    if (start < 0) continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < candidate.length; i += 1) {
      const ch = candidate[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          const parsed = tryParse(candidate.slice(start, i + 1));
          if (parsed !== undefined) return parsed;
          break;
        }
      }
    }
  }
  return null;
}

/** Pull a candidate list out of every shape the model might plausibly return. */
function candidateList(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return [];
  for (const key of ['proposals', 'suggestions', 'options', 'voices', 'directions', 'results']) {
    if (Array.isArray(parsed[key])) return parsed[key];
  }
  // { a: {...}, b: {...} } or { proposal_1, proposal_2 }
  const objects = Object.values(parsed).filter((value) => value && typeof value === 'object' && !Array.isArray(value));
  if (objects.length >= 2) return objects;
  if (objects.length === 1) return objects;
  return [];
}

function buildPrompt({ message, context, history, previous, attempt }) {
  const current = context?.current && typeof context.current === 'object' ? context.current : {};
  const models = Array.isArray(context?.models) ? context.models.slice(0, 40) : [];
  const languages = Array.isArray(context?.languages) ? context.languages.slice(0, 30) : [];
  const historyLines = (Array.isArray(history) ? history.slice(-6) : [])
    .filter((entry) => entry && (entry.role === 'user' || entry.role === 'assistant'))
    .map((entry) => `${entry.role === 'user' ? 'USER' : 'ASSISTANT'}: ${String(entry.text || '').slice(0, 600)}`)
    .join('\n');
  const previousLines = (Array.isArray(previous) ? previous.slice(-2) : [])
    .map((p) => `- ${p.direction}: ${p.description}`)
    .join('\n');

  return [
    'You are a voice director for a text-to-speech studio.',
    'Convert the user request into EXACTLY TWO complete, genuinely different voice-design proposals.',
    'They must be alternatives the user can audition and choose between — not the same voice with a different name.',
    'Return ONLY valid JSON in the schema below. No prose, no markdown fences, no commentary.',
    '',
    'RULES',
    '- Exactly 2 proposals. Never 1, never 3+. Different direction, different rationale, meaningfully different settings.',
    '- Keep CURRENT_FORM.model unless the user explicitly asks for another model; model must be one of AVAILABLE_MODELS.',
    '- Use the language codes in CURRENT_FORM.languages. `auto` means the model chooses.',
    '- The "description" is the voice description: 1-2 sentences, concrete and audible. It feeds the TTS `instruct` field.',
    '- "sample" is the text to speak for an audition, in the target language, 1-2 sentences.',
    '- "reference_text" may only restate user-supplied reference audio. Never invent a transcript; otherwise use "".',
    '- `params` is for model-specific knobs only. For Qwen3-TTS VoiceDesign and Kokoro, use {}. Do not invent parameter names.',
    '- Refinement values are real settings, not prose: use the enums and numeric ranges in the schema.',
    '- The two proposals must be complete: every field filled or explicitly empty, never omitted.',
    '- Write all prose fields in English except `sample`, which is in the voice language.',
    '- If the user asks for a change to a previous direction, keep its identity and change only what was asked.',
    '',
    `USER_REQUEST:\n${String(message || '').slice(0, MAX_MESSAGE_CHARS)}`,
    '',
    `CURRENT_FORM:\n${JSON.stringify({
      model: str(current.model, 200),
      language: str(current.language, 40),
      locale: str(current.locale, 20),
      accent: str(current.accent, MAX_ACCENT_CHARS),
      presentation: str(current.presentation, 40),
      age: str(current.age, 40),
      delivery: str(current.delivery, 40),
      description: str(current.description, MAX_DESCRIPTION_CHARS),
      sample: str(current.sample, MAX_SAMPLE_CHARS),
      languages: languages.map((item) => (typeof item === 'string' ? item : { code: item?.code, label: item?.label })),
    }, null, 0)}`,
    '',
    `AVAILABLE_MODELS: ${JSON.stringify(models)}`,
    ...(historyLines ? ['', `CONVERSATION:\n${historyLines}`] : []),
    ...(previousLines ? ['', `PREVIOUS DIRECTIONS:\n${previousLines}`] : []),
    ...(attempt > 1 ? ['', `CORRECTION: your previous reply was not usable (${context.lastError || 'wrong shape'}). Return exactly two distinct proposals in the required JSON.`] : []),
    '',
    `OUTPUT SCHEMA (return {"proposals":[...]}):\n${OUTPUT_SCHEMA}`,
  ].join('\n');
}

/**
 * Ask the engine for two proposals and enforce the contract.
 * `ask(prompt) -> Promise<string>` is injected so this module is unit-testable.
 */
export async function generateProposals(ask, { message, context = {}, history = [], previous = [] }) {
  const started = Date.now();
  const attempts = [];
  let lastError = 'the model did not return two proposals';
  let lastProposals = [];

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const prompt = buildPrompt({ message, context: { ...context, lastError }, history, previous, attempt });
    let reply;
    try {
      reply = await ask(prompt);
    } catch (err) {
      lastError = `engine call failed: ${err.message}`;
      attempts.push({ attempt, error: lastError });
      continue;
    }
    const parsed = extractJson(reply);
    const rawList = candidateList(parsed);
    if (!rawList.length) {
      lastError = 'no JSON proposals found in the reply';
      attempts.push({ attempt, error: lastError, reply_sample: String(reply).slice(0, 400) });
      continue;
    }

    const normalized = rawList.map((item, index) => normalizeProposal(item, context, index));
    const unique = [];
    for (const proposal of normalized) {
      if (unique.some((other) => proposalSignature(other) === proposalSignature(proposal))) continue;
      if (unique.some((other) => sameDirection(other, proposal))) continue;
      unique.push(proposal);
      if (unique.length === 2) break;
    }
    lastProposals = unique;
    attempts.push({ attempt, proposals: unique.length });

    if (unique.length === 2) {
      return {
        proposals: unique,
        attempts,
        elapsed_ms: Date.now() - started,
      };
    }
    lastError = `the model returned ${unique.length || 0} usable distinct proposal(s); exactly 2 are required`;
  }

  // The first proposal is often usable even when the pair is not. Ask once more
  // for a single contrasting alternative — a real second direction, not a clone.
  if (lastProposals.length === 1) {
    const first = lastProposals[0];
    const prompt = [
      'You are a voice director. A previous reply produced one usable voice direction.',
      `FIRST DIRECTION:\n${JSON.stringify({
        direction: first.direction, name: first.name, model: first.model,
        language: first.language, locale: first.locale, accent: first.accent,
        presentation: first.presentation, age: first.age, delivery: first.delivery,
        description: first.description, refine: first.refine,
      })}`,
      `USER_REQUEST:\n${String(message || '').slice(0, MAX_MESSAGE_CHARS)}`,
      'Return ONLY valid JSON: {"proposals":[ONE complete proposal that is a genuinely different direction from the first]}',
      'Keep the same model and language unless the user asked otherwise. Fill every field.',
    ].join('\n\n');
    try {
      const reply = await ask(prompt);
      const parsed = extractJson(reply);
      const rawList = candidateList(parsed);
      if (rawList.length) {
        const second = normalizeProposal(rawList[0], context, 1);
        if (proposalSignature(second) !== proposalSignature(first) && !sameDirection(first, second)) {
          return {
            proposals: [first, second],
            attempts: [...attempts, { attempt: 4, proposals: 2, note: 'completed with a contrasting second call' }],
            elapsed_ms: Date.now() - started,
          };
        }
      }
    } catch { /* fall through to the honest error */ }
  }

  const error = Object.assign(
    new Error(`the engine did not produce two distinct voice proposals (${lastError}); try rephrasing the request`),
    { status: 502, attempts },
  );
  throw error;
}

/* ── persistence (per user) ─────────────────────────────────────────────── */

function usersRoot() {
  const dir = config.state.voiceAgentDir || join(config.state.dir, 'voice-design-agent');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function safeUser(userId) {
  const raw = String(userId || 'local').trim().toLowerCase();
  const safe = raw.replace(/[^a-z0-9._@+-]+/g, '-').replace(/^[.-]+/, '').slice(0, 80);
  return safe || 'local';
}

function safeSessionId(id) {
  return /^vds-[A-Za-z0-9-]{6,80}$/.test(String(id || '')) ? String(id) : null;
}

function sessionsDir(userId) {
  const dir = join(usersRoot(), safeUser(userId), 'sessions');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function sessionFile(userId, id) {
  const safe = safeSessionId(id);
  if (!safe) return null;
  return join(sessionsDir(userId), `${safe}.json`);
}

function readSessionFile(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeSession(userId, session) {
  const file = sessionFile(userId, session.id);
  if (!file) throw Object.assign(new Error('invalid session id'), { status: 400 });
  const record = { ...session, user_id: safeUser(userId), updated_at: new Date().toISOString() };
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(record, null, 2));
  renameSync(tmp, file);
  return record;
}

export function resolveUserId(req) {
  const header = req?.headers?.['x-oia-user'] || req?.headers?.['x-oia-user-email'];
  if (header) return safeUser(header);
  return safeUser(process.env.OIA_USER_ID || 'local');
}

export function createSession(userId, { title } = {}) {
  const now = new Date().toISOString();
  const session = {
    id: `vds-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    user_id: safeUser(userId),
    title: str(title, 120) || 'New voice design',
    created_at: now,
    updated_at: now,
    messages: [],
    proposals: [],
  };
  return writeSession(userId, session);
}

export function getSession(userId, id) {
  const file = sessionFile(userId, id);
  if (!file || !existsSync(file)) return null;
  return readSessionFile(file);
}

export function listSessions(userId, { limit = 20 } = {}) {
  const dir = sessionsDir(userId);
  const sessions = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const session = readSessionFile(join(dir, name));
    if (!session) continue;
    const lastProposal = Array.isArray(session.proposals) ? session.proposals[session.proposals.length - 1] : null;
    sessions.push({
      id: session.id,
      title: session.title || 'Voice design',
      created_at: session.created_at,
      updated_at: session.updated_at,
      message_count: Array.isArray(session.messages) ? session.messages.length : 0,
      proposal_count: Array.isArray(session.proposals) ? session.proposals.length : 0,
      last_direction: lastProposal?.direction || null,
    });
  }
  sessions.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  if (sessions.length > MAX_SESSIONS) {
    // Prune the oldest files, not just the returned page.
    for (const stale of sessions.slice(MAX_SESSIONS)) {
      const file = sessionFile(userId, stale.id);
      if (file) rmSync(file, { force: true });
    }
  }
  return { sessions: sessions.slice(0, Math.max(1, Math.min(60, limit))) };
}

export function deleteSession(userId, id) {
  const file = sessionFile(userId, id);
  if (!file || !existsSync(file)) return false;
  rmSync(file, { force: true });
  return true;
}

export function appendTurn(userId, sessionId, { message, proposals, assistantText }) {
  let session = sessionId ? getSession(userId, sessionId) : null;
  if (!session) session = createSession(userId, { title: String(message || '').slice(0, 80) });
  if (!session.title || session.title === 'New voice design') {
    session.title = str(message, 80) || 'Voice design';
  }
  const now = new Date().toISOString();
  session.messages.push({
    id: `vdm-${randomUUID()}`,
    role: 'user',
    text: str(message, MAX_MESSAGE_CHARS),
    at: now,
  });
  session.messages.push({
    id: `vdm-${randomUUID()}`,
    role: 'assistant',
    text: str(assistantText, 1600),
    at: now,
    proposal_ids: proposals.map((proposal) => proposal.id),
  });
  session.proposals.push(...proposals);
  if (session.messages.length > MAX_MESSAGES) session.messages = session.messages.slice(-MAX_MESSAGES);
  if (session.proposals.length > MAX_PROPOSALS) session.proposals = session.proposals.slice(-MAX_PROPOSALS);
  return writeSession(userId, session);
}

export function markApplied(userId, sessionId, proposalId) {
  const session = getSession(userId, sessionId);
  if (!session) throw Object.assign(new Error('session not found'), { status: 404 });
  const proposal = session.proposals.find((item) => item.id === proposalId);
  if (!proposal) throw Object.assign(new Error('proposal not found'), { status: 404 });
  proposal.applied_at = new Date().toISOString();
  return writeSession(userId, session);
}

/** The speech payload for a saved proposal (used by the preview route). */
export function proposalSpeechPayload(proposal) {
  const refine = proposal.refine || {};
  return {
    model: proposal.model,
    input: proposal.sample,
    instruct: proposal.instruct,
    lang_code: proposal.language || undefined,
    response_format: 'wav',
    speed: refine.rate,
  };
}

export const SCHEMA_LIMITS = Object.freeze({
  maxSessions: MAX_SESSIONS,
  maxMessages: MAX_MESSAGES,
  maxProposals: MAX_PROPOSALS,
});
