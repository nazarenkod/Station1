// Ported from vision: keep in sync until both use a shared package.
import {createHash} from 'node:crypto';

import {describe, expect, it} from 'vitest';

import {
  classOf,
  compilePattern,
  componentOf,
  facetsFromKey,
  facetsOf,
  markerQuery,
  problemCode,
  problemComponent,
  problemKeyOf,
  problemMarkers,
  type ProblemClass,
  screenTitle,
} from '../../app/common/renderer/lib/a11y/problems';
import {sha1Hex} from '../../app/common/renderer/lib/a11y/sha1';
import {parseUiTree} from '../../app/common/renderer/lib/a11y/ui-tree';

const touch = (nodeKey: string, widthDp: number, screen = 'Адреси', heightDp = 38) =>
  facetsOf(
    {rule: 'touch-target', nodeKey, details: {widthDp, heightDp}, className: 'android.widget.Button', label: 'x'},
    screen,
  );
const rule = (name: string, nodeKey: string, screen = 'a') => facetsOf({rule: name as never, nodeKey}, screen);

describe('componentOf and facetsOf', () => {
  it('takes the component id of a Compose tag, a resource id without package, nothing without an id', () => {
    expect(componentOf('id:Адреса реєстрації#PbButton')).toBe('PbButton');
    expect(componentOf('id:Адреса реєстрації#PbButton#2')).toBe('PbButton');
    expect(componentOf('id:com.bank:id/tab_0')).toBe('tab_0');
    expect(componentOf('id:com.bank:id/btn#1')).toBe('btn');
    expect(componentOf('Button:Далі')).toBeNull();
  });

  it('keeps the facts of an issue that no setting changes', () => {
    expect(touch('id:Адреса#PbButton#1', 38.2)).toEqual({
      rule: 'touch-target',
      element: 'Адреса#PbButton',
      nodeKey: 'id:Адреса#PbButton#1',
      component: 'PbButton',
      screen: 'Адреси',
      measure: '38x38',
      className: 'android.widget.Button',
      label: 'x',
    });
  });
});

describe('problemKeyOf', () => {
  it('is one problem for the same component and tap area on any screen, another for another area', () => {
    expect(problemKeyOf(touch('id:A#PbButton', 38.2))).toBe('touch-target|c:PbButton|38x38');
    expect(problemKeyOf(touch('id:B#PbButton', 37.8, 'Платежі'))).toBe('touch-target|c:PbButton|38x38');
    expect(problemKeyOf(touch('id:B#PbButton', 40, 'Платежі'))).toBe('touch-target|c:PbButton|40x38');
  });

  it('keeps ids apart and makes an element without an id a problem of its screen only', () => {
    expect(problemKeyOf(touch('id:com.bank:id/tab_0', 38))).not.toBe(problemKeyOf(touch('id:com.bank:id/tab_1', 38)));
    expect(problemKeyOf(touch('Button:Далі', 38))).toBe('touch-target|s:Адреси|e:Button:Далі');
    expect(problemKeyOf(touch('Button:Далі', 38, 'Платежі'))).not.toBe(problemKeyOf(touch('Button:Далі', 38)));
  });

  it('follows the per-rule settings', () => {
    const anySize = {duplicateModes: {'touch-target': 'component' as const}};
    expect(problemKeyOf(touch('id:A#PbButton', 38), anySize)).toBe(problemKeyOf(touch('id:A#PbButton', 44), anySize));
    const perScreen = {duplicateModes: {'touch-target': 'screen' as const}};
    expect(problemKeyOf(touch('id:A#PbButton', 38), perScreen)).toBe('touch-target|s:Адреси|c:PbButton|38x38');
    expect(problemKeyOf(rule('missing-label', 'id:x:id/scan'))).toBe('missing-label|c:scan|');
    expect(problemKeyOf(rule('duplicate-label', 'id:x:id/scan'))).toBe('duplicate-label|s:a|c:scan|');
  });
});

describe('problem classes', () => {
  const tabs: ProblemClass = {
    id: 't',
    name: 'Tab bar',
    when: {element: ['/^.*:id\\/(tab)_\\d+$/']},
    groupBy: 'component',
  };

  it('compiles globs over the whole value, case-insensitive, and regexes as written', () => {
    expect(compilePattern('*:id/decor_*').test('com.bank:id/DECOR_1')).toBe(true);
    expect(compilePattern('*:id/decor_*').test('com.bank:id/decor')).toBe(false);
    expect(compilePattern('/PbButton$/').test('Адреса#PbButton')).toBe(true);
    expect(compilePattern('/(/')).toBeNull();
  });

  it('takes an issue when every field given matches, any pattern of a field may', () => {
    const onboarding: ProblemClass = {
      id: 'o',
      name: 'Onboarding buttons',
      rules: ['touch-target'],
      when: {element: ['*#PbButton', '*#PbLink'], screen: ['Онбординг*']},
    };
    expect(classOf(touch('id:Далі#PbLink', 38, 'Онбординг 2'), [onboarding])?.problemClass).toBe(onboarding);
    // the element matches, the screen does not
    expect(classOf(touch('id:Далі#PbLink', 38, 'Платежі'), [onboarding])).toBeNull();
    // the rule is not the class's
    expect(classOf(rule('missing-label', 'id:Далі#PbLink', 'Онбординг'), [onboarding])).toBeNull();
    // label and class name conditions
    expect(
      classOf(touch('id:x', 38), [{id: 'l', name: 'L', when: {label: ['x'], className: ['*Button']}}]),
    ).not.toBeNull();
    // a class without any condition takes nothing
    expect(classOf(touch('id:x', 38), [{id: 'e', name: 'Empty', when: {}}])).toBeNull();
  });

  it('reads classes written with a single element pattern', () => {
    expect(
      classOf(touch('id:com.bank:id/decor_1', 38), [{id: 'd', name: 'D', match: '*decor_*'}])?.problemClass.id,
    ).toBe('d');
  });

  it('lets a regex group be the component, and a class be one problem for all it takes', () => {
    const settings = {classes: [tabs]};
    expect(problemKeyOf(touch('id:com.bank:id/tab_0', 38), settings)).toBe('touch-target|c:tab|');
    expect(problemKeyOf(touch('id:com.bank:id/tab_3', 44, 'b'), settings)).toBe('touch-target|c:tab|');
    const icons: ProblemClass = {
      id: 'i',
      name: 'Status icons',
      when: {element: ['*:id/status_*']},
      groupBy: 'class',
    };
    expect(problemKeyOf(touch('id:x:id/status_wifi', 20), {classes: [icons]})).toBe(
      problemKeyOf(touch('id:x:id/status_battery', 24, 'b'), {classes: [icons]}),
    );
  });
});

describe('Jira markers', () => {
  it('labels a bug with its id, rule, component, values and class', () => {
    expect(problemMarkers('a11y-3f9c2a1b', touch('id:A#PbButton', 38))).toEqual([
      'a11y-3f9c2a1b',
      'a11y-touch-target',
      'a11y-component-PbButton',
      'a11y-value-38x38',
    ]);
    const tabs: ProblemClass = {id: 't', name: 'Tab bar', when: {element: ['/(tab)_\\d+$/']}, groupBy: 'component'};
    expect(problemMarkers('a11y-1', touch('id:x:id/tab_0', 38), {classes: [tabs]})).toContain('a11y-class-Tab_bar');
  });

  it('searches by the markers the current settings tell problems apart with', () => {
    expect(markerQuery(touch('id:A#PbButton', 38))).toEqual([
      'a11y-touch-target',
      'a11y-component-PbButton',
      'a11y-value-38x38',
    ]);
    expect(markerQuery(touch('id:A#PbButton', 38), {duplicateModes: {'touch-target': 'component'}})).toEqual([
      'a11y-touch-target',
      'a11y-component-PbButton',
    ]);
    // one screen's problem is found by its id only
    expect(markerQuery(touch('Button:Далі', 38))).toBeNull();
  });
});

describe('problemCode, problemComponent and facetsFromKey', () => {
  it('gives a short id from the key at creation', () => {
    const code = problemCode('p1', 'touch-target|c:PbButton|38x38');
    expect(code).toMatch(/^a11y-[0-9a-f]{8}$/);
    expect(problemCode('p2', 'touch-target|c:PbButton|38x38')).not.toBe(code);
    expect(problemComponent('touch-target|c:PbButton|38x38')).toBe('PbButton');
    expect(problemComponent('touch-target|s:a|e:Button:x')).toBeNull();
  });

  it('reads the facts back from keys of problems stored before facts were kept', () => {
    expect(facetsFromKey('touch-target|c:PbButton|38x38')).toMatchObject({
      rule: 'touch-target',
      component: 'PbButton',
      measure: '38x38',
    });
    expect(problemKeyOf(facetsFromKey('touch-target|c:PbButton|38x38'))).toBe('touch-target|c:PbButton|38x38');
    expect(problemKeyOf(facetsFromKey('missing-label|c:scan|'))).toBe('missing-label|c:scan|');
    expect(problemKeyOf(facetsFromKey('touch-target|s:Адреси|e:Button:Далі'))).toBe(
      'touch-target|s:Адреси|e:Button:Далі',
    );
  });
});

describe('screenTitle', () => {
  const xml = `<hierarchy width="1080" height="2400"><android.widget.FrameLayout class="android.widget.FrameLayout" bounds="[0,0][1080,2400]">
      <android.view.View class="android.view.View" resource-id="Appbar#Title" bounds="[0,60][1080,200]">
        <android.widget.TextView class="android.widget.TextView" text="Адреса проживання" bounds="[40,80][800,180]"/>
      </android.view.View>
      <android.widget.TextView class="android.widget.TextView" resource-id="com.bank:id/toolbar_title" text="Платежі" bounds="[40,300][800,380]"/>
    </android.widget.FrameLayout></hierarchy>`;
  const tree = parseUiTree(xml, {imageWidth: 1080, imageHeight: 2400});

  it('reads the title by the project selectors, first match wins', () => {
    expect(screenTitle(tree)).toBe('Адреса проживання');
    expect(screenTitle(tree, ['id:toolbar_title', 'id:Appbar#Title'])).toBe('Платежі');
    expect(screenTitle(tree, ['id:missing', 'Appbar#Title'])).toBe('Адреса проживання');
    expect(screenTitle(tree, ['id:missing'])).toBeNull();
    expect(screenTitle(null)).toBeNull();
  });
});

describe('sha1Hex', () => {
  it('gives the same hash as node:crypto, so ids match vision', () => {
    for (const text of ['', 'abc', 'p1\ntouch-target|c:PbButton|38x38', 'Кредит готівкою#PbButton', 'x'.repeat(200)]) {
      expect(sha1Hex(text)).toBe(createHash('sha1').update(text).digest('hex'));
    }
    expect(problemCode('p1', 'touch-target|c:PbButton|38x38')).toBe(
      `a11y-${createHash('sha1').update('p1\ntouch-target|c:PbButton|38x38').digest('hex').slice(0, 8)}`,
    );
  });
});
