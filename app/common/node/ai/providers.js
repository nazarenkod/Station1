import {spawn} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {shellEnv} from '../doctor/exec.js';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_TIMEOUT_MS = 90000;
const KIRO_TIMEOUT_MS = 180000;

export const DEFAULT_MODELS = {
  // the cheapest current Gemini tier, as in vision; the alias follows Google's latest release
  gemini: 'gemini-flash-lite-latest',
  // Kiro CLI picks its own default model when none is given
  kiro: '',
};

/**
 * The JSON object in a model's answer: the whole text, a ```json block, or the
 * last balanced {...} in it (Kiro CLI prints tool notes around its answer).
 */
export function extractJson(text) {
  // oxlint-disable-next-line no-control-regex
  const clean = String(text ?? '').replace(/\x1b\[[\d;?]*[A-Za-z]/g, '');
  try {
    return JSON.parse(clean.trim());
  } catch {
    // look further
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(clean);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // look further
    }
  }
  for (let end = clean.lastIndexOf('}'); end > 0; end = clean.lastIndexOf('}', end - 1)) {
    let depth = 0;
    for (let start = end; start >= 0; start--) {
      if (clean[start] === '}') {
        depth++;
      } else if (clean[start] === '{') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(clean.slice(start, end + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error('The model did not answer with JSON');
}

/**
 * Gemini through its REST API: the prompt and PNG images in, a JSON text out.
 */
export async function askGemini({apiKey, model, prompt, images = [], fetchImpl = fetch}) {
  if (!apiKey) {
    throw new Error('Add a Gemini API key in the AI settings');
  }
  const response = await fetchImpl(
    `${GEMINI_ENDPOINT}/${encodeURIComponent(model || DEFAULT_MODELS.gemini)}:generateContent`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'x-goog-api-key': apiKey},
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{text: prompt}, ...images.map((data) => ({inlineData: {mimeType: 'image/png', data}}))],
          },
        ],
        generationConfig: {temperature: 0.2, responseMimeType: 'application/json'},
      }),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Gemini ${response.status}: ${body?.error?.message ?? response.statusText}`);
  }
  const text = body?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
  return extractJson(text);
}

/**
 * Kiro CLI, with the account it is already signed in to: images go to a
 * temporary folder it may only read from, the answer is the JSON it prints.
 */
export async function askKiro({model, prompt, images = [], binary = 'kiro-cli'}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vision-ai-'));
  try {
    const files = [];
    for (const [index, data] of images.entries()) {
      const file = path.join(dir, `image-${index + 1}.png`);
      await writeFile(file, Buffer.from(data, 'base64'));
      files.push(file);
    }
    const fullPrompt = [
      files.length ? `Read these image files first, in this order: ${files.join(', ')}.` : '',
      prompt,
      'Answer with the JSON object only, no other text.',
    ]
      .filter(Boolean)
      .join('\n\n');
    const args = ['chat', '--no-interactive', '--trust-tools=fs_read', '--wrap', 'never'];
    if (model) {
      args.push('--model', model);
    }
    args.push(fullPrompt);
    const output = await new Promise((resolve, reject) => {
      shellEnv().then((env) => {
        const child = spawn(binary, args, {cwd: dir, env});
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error('Kiro CLI did not answer in time'));
        }, KIRO_TIMEOUT_MS);
        child.stdout.on('data', (data) => (stdout += data));
        child.stderr.on('data', (data) => (stderr += data));
        child.on('error', (error) => {
          clearTimeout(timer);
          reject(error.code === 'ENOENT' ? new Error('Kiro CLI is not installed (kiro-cli not found)') : error);
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0) {
            resolve(stdout);
          } else {
            reject(new Error(`Kiro CLI failed: ${(stderr || stdout).trim().split('\n').slice(-3).join(' ')}`));
          }
        });
      }, reject);
    });
    return extractJson(output);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}
