import {readFileSync} from 'node:fs';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {auditScreen, failsAt} from '../../app/common/node/a11y/audit.js';
import {toJson, toJunit, toText} from '../../app/common/node/a11y/formats.js';
import {decide, emptyStore} from '../../app/common/renderer/lib/a11y/issues';
import {A11Y_RULES} from '../../app/common/renderer/lib/a11y/types';

const source = readFileSync(path.join(import.meta.dirname, '../fixtures/a11y/android-payment.xml'), 'utf8');

describe('CLI audit', function () {
  it('checks a saved source and fails on errors by default', function () {
    const result = auditScreen({sourceXml: source, densityDpi: 420, appId: 'com.bank.app'});
    expect(result.reviewed.summary.errors).toBe(1);
    expect(failsAt(result.reviewed, 'error')).toBe(true);
    expect(failsAt(result.reviewed, 'none')).toBe(false);
    expect(toText(result)).toContain('✖ Control has no label [missing-label]');
  });

  it('lets filed and ignored problems pass, from exported decisions', function () {
    const first = auditScreen({sourceXml: source, densityDpi: 420, appId: 'com.bank.app'});
    const error = first.reviewed.open.find((group) => group.severity === 'error');
    const decisions = decide(emptyStore(), error, {status: 'reported', jiraKey: 'PAY-77'}, 'filed', first.context);
    const result = auditScreen({sourceXml: source, densityDpi: 420, appId: 'com.bank.app', decisions});
    expect(failsAt(result.reviewed, 'error')).toBe(false);
    expect(JSON.parse(toJson(result)).reported).toEqual([{code: error.code, rule: 'missing-label', jiraKey: 'PAY-77'}]);
  });

  it('writes one JUnit test case per rule, failing ones with their issues', function () {
    const result = auditScreen({sourceXml: source, densityDpi: 420, appId: 'com.bank.app'});
    const xml = toJunit(result, A11Y_RULES);
    expect(xml).toContain(`tests="${A11Y_RULES.length}"`);
    expect(xml).toMatch(/<testcase classname="[^"]+" name="missing-label">\s*<failure message="1 problem\(s\)">/);
    // advice never fails a build
    expect(xml).toContain('name="redundant-role"/>');
  });

  it('applies a rules config', function () {
    const result = auditScreen({
      sourceXml: source,
      densityDpi: 420,
      config: {rules: {'missing-label': {enabled: false}}},
    });
    expect(result.reviewed.open.some((v) => v.rule === 'missing-label')).toBe(false);
  });
});
