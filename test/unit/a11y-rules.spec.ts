// Ported from vision: keep in sync until both use a shared package.
import {readFileSync} from 'node:fs';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {DEFAULT_A11Y_CONFIG} from '../../app/common/renderer/lib/a11y/config';
import {contrastRatio, estimateContrast} from '../../app/common/renderer/lib/a11y/contrast';
import {findViolations as findAll} from '../../app/common/renderer/lib/a11y/rules';
import {A11Y_RULES} from '../../app/common/renderer/lib/a11y/types';
import type {RgbaImage} from '../../app/common/renderer/lib/a11y/types';
import {parseUiTree} from '../../app/common/renderer/lib/a11y/ui-tree';

// vision's seven rules only, to check they behave as they do there
const VISION_RULES = [
  'missing-label',
  'touch-target',
  'duplicate-label',
  'low-contrast',
  'input-without-label',
  'redundant-role',
  'not-accessible',
];
const visionConfig = structuredClone(DEFAULT_A11Y_CONFIG);
for (const rule of A11Y_RULES) {
  visionConfig.rules[rule].enabled = VISION_RULES.includes(rule);
}
const findViolations = (tree, image?) => findAll(tree, image, visionConfig);

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, '../fixtures/a11y', name), 'utf8');

function solidImage(width: number, height: number, rgb: [number, number, number]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data.set([...rgb, 255], i * 4);
  }
  return {width, height, data};
}

function fillRect(image: RgbaImage, x: number, y: number, w: number, h: number, rgb: [number, number, number]) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      image.data.set([...rgb, 255], (yy * image.width + xx) * 4);
    }
  }
}

describe('findViolations', () => {
  it('finds the issues of an Android screen', () => {
    const tree = parseUiTree(fixture('android-payment.xml'), {imageWidth: 1080, imageHeight: 2400, densityDpi: 420});

    const ids = findViolations(tree)
      .map((v) => v.id)
      .sort();

    expect(ids).toEqual(
      [
        'duplicate-label|id:com.bank.app:id/btn_next_bottom',
        'duplicate-label|id:com.bank.app:id/btn_next_top',
        'input-without-label|id:com.bank.app:id/et_amount',
        'missing-label|id:com.bank.app:id/btn_scan_qr',
        'redundant-role|id:com.bank.app:id/btn_close',
        'touch-target|id:com.bank.app:id/btn_help',
        'touch-target|id:com.bank.app:id/btn_scan_qr',
      ].sort(),
    );
  });

  it('reports touch target size in dp', () => {
    const tree = parseUiTree(fixture('android-payment.xml'), {imageWidth: 1080, imageHeight: 2400, densityDpi: 420});
    const help = findViolations(tree).find((v) => v.id === 'touch-target|id:com.bank.app:id/btn_help');
    expect(help.details).toMatchObject({widthDp: 35.8, heightDp: 35.8, min: 48});
    expect(help.message).toContain('36 × 36 dp');
  });

  it('reads the text of child views as the label of a clickable container', () => {
    const tree = parseUiTree(fixture('android-payment.xml'), {imageWidth: 1080, imageHeight: 2400, densityDpi: 420});
    expect(findViolations(tree).some((v) => v.nodeKey.endsWith('row_template'))).toBe(false);
  });

  it('finds the issues of an iOS screen', () => {
    const tree = parseUiTree(fixture('ios-payment.xml'), {imageWidth: 1170, imageHeight: 2532});

    const ids = findViolations(tree)
      .map((v) => v.id)
      .sort();

    expect(ids).toEqual(
      [
        'input-without-label|id:amountField',
        'missing-label|id:closeButton',
        'not-accessible|id:helpButton',
        'touch-target|id:closeButton',
      ].sort(),
    );
  });

  it('checks text contrast against the screenshot', () => {
    const tree = parseUiTree(fixture('android-payment.xml'), {imageWidth: 1080, imageHeight: 2400, densityDpi: 420});
    const image = solidImage(1080, 2400, [255, 255, 255]);
    // "Commission 0 UAH" drawn in light grey, "Pay" in white on dark green
    fillRect(image, 50, 1010, 300, 25, [200, 200, 200]);
    fillRect(image, 42, 2200, 996, 126, [35, 122, 48]);
    fillRect(image, 480, 2240, 120, 40, [255, 255, 255]);

    const contrast = findViolations(tree, image).filter((v) => v.rule === 'low-contrast');

    expect(contrast.map((v) => v.nodeKey)).toEqual(['id:com.bank.app:id/tv_fee']);
    expect(contrast[0].details).toMatchObject({required: 4.5, foreground: '#c8c8c8', background: '#ffffff'});
  });
});

describe('estimateContrast', () => {
  it('measures black on white as 21:1', () => {
    const image = solidImage(100, 40, [255, 255, 255]);
    fillRect(image, 10, 10, 60, 20, [0, 0, 0]);
    expect(estimateContrast(image, {x: 0, y: 0, width: 100, height: 40}).ratio).toBe(21);
  });

  it('returns null for a uniform box', () => {
    const image = solidImage(50, 50, [240, 240, 240]);
    expect(estimateContrast(image, {x: 0, y: 0, width: 50, height: 50})).toBeNull();
  });

  it('ignores faint anti-aliasing when picking the text colour', () => {
    const image = solidImage(100, 40, [255, 255, 255]);
    fillRect(image, 10, 10, 60, 20, [0, 0, 0]);
    fillRect(image, 9, 9, 62, 1, [250, 250, 250]);
    expect(estimateContrast(image, {x: 0, y: 0, width: 100, height: 40}).foreground).toBe('#000000');
  });

  it('computes WCAG ratios', () => {
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBe(21);
    expect(contrastRatio([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 1);
  });
});
