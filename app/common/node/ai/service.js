import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';

import {askGemini, askKiro, DEFAULT_MODELS} from './providers.js';

const DEFAULT_DAILY_LIMIT = 200;
const MAX_CACHE_ENTRIES = 500;

export const DEFAULT_AI_SETTINGS = {
  provider: 'none',
  model: '',
  consent: false,
  dailyLimit: DEFAULT_DAILY_LIMIT,
  // values that never leave the machine: card numbers, IBANs, phones, emails
  maskPatterns: [
    '\\b\\d{4}[ -]?\\d{2,4}[ -]?\\d{2,4}[ -]?\\d{4}\\b',
    '\\bUA\\d{2}[ \\d]{20,}\\b',
    '\\+?\\d[\\d ()-]{8,}\\d',
    '[\\w.+-]+@[\\w-]+\\.[\\w.]+',
  ],
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The one way to a language model, with vision's rules for keeping it cheap:
 * answers are cached by a hash of everything they depend on, and calls are
 * capped per day. The provider and its key are the person's choice.
 */
export class AiService {
  constructor({getSettings, getKey, cacheFile, ask = {gemini: askGemini, kiro: askKiro}}) {
    this.getSettings = getSettings;
    this.getKey = getKey;
    this.cacheFile = cacheFile;
    this.ask = ask;
    this.cache = null;
  }

  async settings() {
    return {...DEFAULT_AI_SETTINGS, ...(await this.getSettings())};
  }

  async loadCache() {
    if (!this.cache) {
      try {
        this.cache = JSON.parse(await readFile(this.cacheFile, 'utf8'));
      } catch {
        this.cache = {entries: {}, usage: {day: today(), calls: 0}};
      }
    }
    if (this.cache.usage.day !== today()) {
      this.cache.usage = {day: today(), calls: 0};
    }
    return this.cache;
  }

  async saveCache() {
    const keys = Object.keys(this.cache.entries);
    // the oldest answers go first
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_CACHE_ENTRIES))) {
      delete this.cache.entries[key];
    }
    await writeFile(this.cacheFile, JSON.stringify(this.cache)).catch(() => {});
  }

  async status() {
    const settings = await this.settings();
    const cache = await this.loadCache();
    const keyNeeded = settings.provider === 'gemini';
    return {
      provider: settings.provider,
      model: settings.model || DEFAULT_MODELS[settings.provider] || '',
      consent: settings.consent,
      ready: settings.provider !== 'none' && (!keyNeeded || !!(await this.getKey())),
      usedToday: cache.usage.calls,
      dailyLimit: settings.dailyLimit,
    };
  }

  /**
   * Asks the model for a JSON answer. `images` are base64 PNGs.
   */
  async generateJson({kind, prompt, images = [], cacheParts = null}) {
    const settings = await this.settings();
    if (settings.provider === 'none') {
      return {ok: false, error: 'Choose an AI provider in the AI settings'};
    }
    if (!settings.consent) {
      return {ok: false, error: 'consent'};
    }
    const model = settings.model || DEFAULT_MODELS[settings.provider];
    // what the UI shows: Kiro CLI picks its own model when none is set
    const shownModel = model || (settings.provider === 'kiro' ? 'Kiro CLI' : settings.provider);
    const digest = createHash('sha256').update(`${kind}|${settings.provider}|${model}|${prompt}`);
    digest.update(JSON.stringify(cacheParts));
    for (const image of images) {
      digest.update(image);
    }
    const cacheKey = digest.digest('hex');
    const cache = await this.loadCache();
    if (cache.entries[cacheKey]) {
      return {ok: true, result: cache.entries[cacheKey], cached: true, model: shownModel};
    }
    if (cache.usage.calls >= settings.dailyLimit) {
      return {ok: false, error: `Daily AI limit of ${settings.dailyLimit} calls reached`};
    }
    try {
      cache.usage.calls++;
      const result =
        settings.provider === 'gemini'
          ? await this.ask.gemini({apiKey: await this.getKey(), model, prompt, images})
          : await this.ask.kiro({model, prompt, images});
      cache.entries[cacheKey] = result;
      await this.saveCache();
      return {ok: true, result, cached: false, model: shownModel};
    } catch (error) {
      await this.saveCache();
      return {ok: false, error: error.message};
    }
  }
}
