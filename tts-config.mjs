/**
 * tts-config.mjs — Studio Layers TTS configuration.
 *
 * MLX-Audio is an optional local runtime, like the Python crawler sidecar. It is
 * never installed by this project; the service discovers an existing venv and
 * links its model cache read-only into data/tts.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

const bool = (value, fallback) => {
    if (value === undefined) return fallback;
    return /^(1|true|yes|on)$/i.test(String(value));
};
const number = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};
const csv = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);

export const config = {
    repoRoot: ROOT,
    http: {
        port: number(env.PORT, 8008),
    },
    state: {
        dir: path.join(ROOT, 'data', 'tts'),
        voiceAgentDir: path.join(ROOT, 'data', 'voice-design-agent'),
    },
    tts: {
        url: env.STUDIO_TTS_URL || env.OIA_TTS_URL || 'http://127.0.0.1:8771',
        autostart: bool(env.STUDIO_TTS_AUTOSTART ?? env.OIA_TTS_AUTOSTART, true),
        python: env.STUDIO_TTS_PYTHON || env.OIA_MLX_TTS_PYTHON || '',
        externalVenv: env.STUDIO_TTS_VENV || env.OIA_TTS_VENV
            || '/Users/leandrodisconzi/repos/olivia/.tts-venv',
        hfHome: path.resolve(env.STUDIO_TTS_HF_HOME || env.OIA_TTS_HF_HOME
            || path.join(ROOT, 'data', 'tts', 'huggingface')),
        modelSource: path.resolve(env.STUDIO_TTS_MODEL_SOURCE || env.OIA_TTS_MODEL_SOURCE
            || '/Users/leandrodisconzi/repos/olivia/.cache/huggingface'),
        offline: bool(env.STUDIO_TTS_HF_OFFLINE ?? env.OIA_TTS_HF_OFFLINE, true),
        autoRegister: env.STUDIO_TTS_AUTOREGISTER === undefined
            ? (env.OIA_TTS_AUTOREGISTER === undefined
                ? null
                : (/^(0|false|no|off)$/i.test(env.OIA_TTS_AUTOREGISTER) ? [] : csv(env.OIA_TTS_AUTOREGISTER)))
            : (/^(0|false|no|off)$/i.test(env.STUDIO_TTS_AUTOREGISTER) ? [] : csv(env.STUDIO_TTS_AUTOREGISTER)),
        startTimeoutMs: number(env.STUDIO_TTS_START_TIMEOUT_MS, 120000),
        speechTimeoutMs: number(env.STUDIO_TTS_TIMEOUT_MS, 10 * 60 * 1000),
    },
};

export default config;
