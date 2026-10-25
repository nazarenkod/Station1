import {mkdtempSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {describe, expect, it, vi} from 'vitest';

import {extractJson} from '../../app/common/node/ai/providers.js';
import {AiService} from '../../app/common/node/ai/service.js';
import {aiElements, auditPrompt, parseAuditAnswer, parseLabelsAnswer} from '../../app/common/renderer/lib/a11y/ai';
import {parseUiTree} from '../../app/common/renderer/lib/a11y/ui-tree';

const xml = `<hierarchy rotation="0" width="1080" height="2400"><android.widget.FrameLayout class="android.widget.FrameLayout" bounds="[0,0][1080,2400]" displayed="true">
  <android.widget.ImageButton class="android.widget.ImageButton" resource-id="app:id/delete" content-desc="Settings" clickable="true" enabled="true" displayed="true" bounds="[900,100][1040,240]"/>
  <android.widget.TextView class="android.widget.TextView" text="Card 4441 1144 5555 6666" enabled="true" displayed="true" bounds="[40,400][1040,480]"/>
  <android.widget.Button class="android.widget.Button" text="More" clickable="true" enabled="true" displayed="true" bounds="[40,600][540,720]"/>
</android.widget.FrameLayout></hierarchy>`;
const tree = parseUiTree(xml, {imageWidth: 1080, imageHeight: 2400, densityDpi: 420});

describe('AI: what the model gets', function () {
  it('lists the elements with boxes in percent and masked texts', function () {
    const {elements} = aiElements(tree, (text) => text.replace(/\d{4} \d{4} \d{4} \d{4}/, '•••'));
    expect(elements).toEqual([
      {n: 1, type: 'ImageButton', label: 'Settings', id: 'delete', clickable: true, box: [83.3, 4.2, 13, 5.8]},
      {n: 2, type: 'TextView', text: 'Card •••', box: [3.7, 16.7, 92.6, 3.3]},
      {n: 3, type: 'Button', text: 'More', clickable: true, box: [3.7, 25, 46.3, 5]},
    ]);
    expect(auditPrompt(elements, 'uk', 'android')).toContain('in Ukrainian');
  });
});

describe('AI: what the model answers', function () {
  it('finds the JSON in Kiro CLI output with tool notes and colours around it', function () {
    const output =
      '[tool] Reading image /tmp/a.png\n\u001b[32m[tool] status: Completed\u001b[0m\n{"issues": [{"kind": "ai-vague-text"}]}\n';
    expect(extractJson(output)).toEqual({issues: [{kind: 'ai-vague-text'}]});
    expect(extractJson('```json\n{"ok": true}\n```')).toEqual({ok: true});
    expect(() => extractJson('no json here')).toThrow('did not answer with JSON');
  });

  it('turns issues into violations on the right elements, unsure ones as advice', function () {
    const {nodes} = aiElements(tree);
    const found = parseAuditAnswer(
      {
        issues: [
          {
            kind: 'ai-label-mismatch',
            element: 1,
            title: 'Label says Settings',
            message: 'The trash icon is announced as "Settings".',
            fix: 'Label it "Delete".',
            confidence: 0.9,
          },
          {kind: 'ai-vague-text', element: 3, title: 'Vague button', message: '"More" says nothing.', confidence: 0.4},
          {
            kind: 'ai-color-only',
            box: [10, 50, 20, 5],
            title: 'Red only',
            message: 'Error shown in red only.',
            confidence: 0.8,
          },
          {kind: 'made-up-kind', element: 1, title: 'x', message: 'y'},
          {kind: 'ai-affordance', element: 99, title: 'nowhere', message: 'no element, no box'},
        ],
      },
      tree,
      nodes,
    );
    expect(found.map((v) => [v.rule, v.severity, v.resourceId])).toEqual([
      ['ai-vague-text', 'info', ''],
      ['ai-color-only', 'warning', ''],
      ['ai-label-mismatch', 'warning', 'app:id/delete'],
    ]);
    expect(found.find((v) => v.rule === 'ai-color-only').bounds).toEqual({x: 108, y: 1200, width: 216, height: 120});
    expect(found.every((v) => v.source === 'ai')).toBe(true);
    expect(found.find((v) => v.rule === 'ai-label-mismatch').details.fix).toBe('Label it "Delete".');
  });

  it('maps suggested labels back to the issues, in order', function () {
    const issues = [{id: 'missing-label|a'}, {id: 'missing-label|b'}] as never;
    expect(
      parseLabelsAnswer(
        {
          labels: [
            {index: 2, label: 'Close'},
            {index: 7, label: 'x'},
            {index: 1, label: ' '},
          ],
        },
        issues,
      ),
    ).toEqual({
      'missing-label|b': 'Close',
    });
  });
});

describe('AI: the service', function () {
  const service = (settings, ask) =>
    new AiService({
      getSettings: async () => settings,
      getKey: async () => 'key',
      cacheFile: path.join(mkdtempSync(path.join(os.tmpdir(), 'vi-ai-')), 'cache.json'),
      ask,
    });

  it('asks nothing before a provider is chosen and the person agreed', async function () {
    const gemini = vi.fn();
    expect(await service({}, {gemini}).generateJson({kind: 'k', prompt: 'p'})).toMatchObject({ok: false});
    expect(await service({provider: 'gemini'}, {gemini}).generateJson({kind: 'k', prompt: 'p'})).toEqual({
      ok: false,
      error: 'consent',
    });
    expect(gemini).not.toHaveBeenCalled();
  });

  it('answers the same question from the cache and stops at the daily limit', async function () {
    const kiro = vi.fn().mockResolvedValue({issues: []});
    const ai = service({provider: 'kiro', consent: true, dailyLimit: 2}, {kiro});
    const first = await ai.generateJson({kind: 'a11y-audit', prompt: 'p', images: ['aGVsbG8=']});
    const again = await ai.generateJson({kind: 'a11y-audit', prompt: 'p', images: ['aGVsbG8=']});
    expect(first).toMatchObject({ok: true, cached: false});
    expect(again).toMatchObject({ok: true, cached: true});
    expect(kiro).toHaveBeenCalledTimes(1);

    await ai.generateJson({kind: 'a11y-audit', prompt: 'other'});
    expect(await ai.generateJson({kind: 'a11y-audit', prompt: 'third'})).toEqual({
      ok: false,
      error: 'Daily AI limit of 2 calls reached',
    });
  });
});
