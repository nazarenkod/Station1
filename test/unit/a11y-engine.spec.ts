import {readFileSync} from 'node:fs';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {DEFAULT_A11Y_CONFIG, mergeConfig} from '../../app/common/renderer/lib/a11y/config';
import {
  asStore,
  decide,
  emptyStore,
  forget,
  importStore,
  problemContextOf,
  reviewScan,
  unlinkedKeys,
} from '../../app/common/renderer/lib/a11y/issues';
import {readingOrder, scanScreen} from '../../app/common/renderer/lib/a11y/rules';
import {identifyScreen, screenTitle} from '../../app/common/renderer/lib/a11y/screen';
import {parseUiTree} from '../../app/common/renderer/lib/a11y/ui-tree';
import {findJSONElementByPath, xmlToJSON} from '../../app/common/renderer/utils/source-parsing';

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, '../fixtures/a11y', name), 'utf8');

// a 1080 × 2400 Android screen at 420 dpi (2.625 px per dp) built from a few nodes
const androidScreen = (nodes: string) =>
  `<hierarchy rotation="0" width="1080" height="2400"><android.widget.FrameLayout class="android.widget.FrameLayout" bounds="[0,0][1080,2400]" displayed="true">${nodes}</android.widget.FrameLayout></hierarchy>`;

const node = (cls: string, attrs: string, children = '') =>
  `<${cls} class="${cls}" enabled="true" displayed="true" ${attrs}>${children}</${cls}>`;

const scan = (xml: string, onlyRules?: string[]) => {
  const config = structuredClone(DEFAULT_A11Y_CONFIG);
  if (onlyRules) {
    for (const rule of Object.keys(config.rules)) {
      config.rules[rule].enabled = onlyRules.includes(rule);
    }
  }
  return scanScreen(parseUiTree(xml, {imageWidth: 1080, imageHeight: 2400, densityDpi: 420}), undefined, config);
};

const rulesOf = (result) => result.violations.map((v) => `${v.rule}|${v.resourceId || v.label}`).sort();

describe('a11y: element paths', function () {
  it('gives every node the path the inspector uses for the same element', function () {
    for (const [name, options] of [
      ['android-payment.xml', {imageWidth: 1080, imageHeight: 2400, densityDpi: 420}],
      ['ios-payment.xml', {imageWidth: 1170, imageHeight: 2532}],
    ] as const) {
      const xml = fixture(name);
      const tree = parseUiTree(xml, options);
      const json = xmlToJSON(xml);
      for (const uiNode of tree.nodes) {
        const element = findJSONElementByPath(uiNode.elementPath, json);
        expect(element.attributes.class ?? element.attributes.type).toBe(uiNode.className);
      }
    }
  });
});

describe('a11y: rules added by Vision Inspector', function () {
  it('flags labels that read like code and labels that are too long', function () {
    const xml = androidScreen(
      node('android.widget.ImageButton', 'content-desc="ic_close_24" clickable="true" bounds="[0,0][150,150]"') +
        node('android.widget.ImageButton', 'content-desc="shareButton" clickable="true" bounds="[200,0][350,150]"') +
        node(
          'android.widget.ImageButton',
          `content-desc="${'Very long label '.repeat(8)}" clickable="true" bounds="[400,0][550,150]"`,
        ) +
        node('android.widget.ImageButton', 'content-desc="Close" clickable="true" bounds="[600,0][750,150]"'),
    );
    const found = scan(xml, ['non-descriptive-label']).violations;
    expect(found.map((v) => v.details.reason)).toEqual(['code', 'code', 'long']);
  });

  it('flags a field named only by its hint', function () {
    const xml = androidScreen(
      node('android.widget.EditText', 'hint="Amount" text="" clickable="true" bounds="[0,0][1080,150]"') +
        node('android.widget.EditText', 'hint="IBAN" content-desc="IBAN" clickable="true" bounds="[0,200][1080,350]"'),
    );
    expect(rulesOf(scan(xml, ['hint-only-input']))).toEqual(['hint-only-input|Amount']);
  });

  it('flags toggles that do not expose their state', function () {
    const xml = androidScreen(
      node('android.widget.Switch', 'text="Wi-Fi" checkable="false" clickable="true" bounds="[0,0][1080,150]"') +
        node('android.widget.Switch', 'text="Bluetooth" checkable="true" clickable="true" bounds="[0,200][1080,350]"'),
    );
    expect(rulesOf(scan(xml, ['state-missing']))).toEqual(['state-missing|Wi-Fi']);
  });

  it('flags controls nested in a clickable parent on Android', function () {
    const xml = androidScreen(
      node(
        'android.widget.LinearLayout',
        'resource-id="row" clickable="true" bounds="[0,0][1080,200]"',
        node('android.widget.TextView', 'text="Card" bounds="[0,0][800,200]"') +
          node(
            'android.widget.ImageButton',
            'resource-id="more" content-desc="More" clickable="true" bounds="[900,20][1060,180]"',
          ),
      ),
    );
    expect(rulesOf(scan(xml, ['nested-clickable']))).toEqual(['nested-clickable|row']);
  });

  it('flags small targets packed too close together, not well spaced ones', function () {
    // 90 px ≈ 34 dp buttons; the first two touch, the third is far away
    const xml = androidScreen(
      node('android.widget.ImageButton', 'resource-id="a" content-desc="A" clickable="true" bounds="[0,0][90,90]"') +
        node(
          'android.widget.ImageButton',
          'resource-id="b" content-desc="B" clickable="true" bounds="[95,0][185,90]"',
        ) +
        node(
          'android.widget.ImageButton',
          'resource-id="c" content-desc="C" clickable="true" bounds="[600,0][690,90]"',
        ),
    );
    expect(rulesOf(scan(xml, ['target-spacing']))).toEqual(['target-spacing|a', 'target-spacing|b']);
  });

  it('flags truncated text', function () {
    const xml = androidScreen(
      node('android.widget.TextView', 'text="Your transfer to Oleksandr Petrenk…" bounds="[0,0][1080,100]"') +
        node('android.widget.TextView', 'text="Done" bounds="[0,200][1080,300]"'),
    );
    expect(scan(xml, ['text-clipping']).violations).toHaveLength(1);
  });

  it('flags controls without a stable id', function () {
    const xml = androidScreen(
      node('android.widget.Button', 'text="Pay" clickable="true" bounds="[0,0][1080,150]"') +
        node('android.widget.Button', 'resource-id="cancel" text="Cancel" clickable="true" bounds="[0,200][1080,350]"'),
    );
    expect(rulesOf(scan(xml, ['testability']))).toEqual(['testability|Pay']);
  });

  it('flags focus jumping back up and lists the reading order', function () {
    const xml = androidScreen(
      node('android.widget.TextView', 'text="Bottom" bounds="[0,1000][1080,1100]"') +
        node('android.widget.TextView', 'text="Top" bounds="[0,100][1080,200]"'),
    );
    const result = scan(xml, ['reading-order']);
    expect(rulesOf(result)).toEqual(['reading-order|Top']);
    expect(result.readingOrder.map((entry) => entry.nodeKey)).toEqual(['TextView:Bottom', 'TextView:Top']);
  });

  it('flags invisible iOS elements on screen that VoiceOver can focus, not scrolled-away ones', function () {
    const xml = `<AppiumAUT><XCUIElementTypeApplication type="XCUIElementTypeApplication" name="App" label="App" enabled="true" visible="true" accessible="false" x="0" y="0" width="390" height="844">
      <XCUIElementTypeButton type="XCUIElementTypeButton" name="ghost" label="Ghost" enabled="true" visible="false" accessible="true" x="10" y="100" width="100" height="44"/>
      <XCUIElementTypeButton type="XCUIElementTypeButton" name="below" label="Below" enabled="true" visible="false" accessible="true" x="10" y="1200" width="100" height="44"/>
    </XCUIElementTypeApplication></AppiumAUT>`;
    const tree = parseUiTree(xml, {imageWidth: 1170, imageHeight: 2532});
    const config = structuredClone(DEFAULT_A11Y_CONFIG);
    for (const rule of Object.keys(config.rules)) {
      config.rules[rule].enabled = rule === 'hidden-focusable';
    }
    expect(scanScreen(tree, undefined, config).violations.map((v) => v.resourceId)).toEqual(['ghost']);
  });

  it('checks the contrast of icon buttons against the background', function () {
    const xml = androidScreen(
      node(
        'android.widget.ImageButton',
        'resource-id="star" content-desc="Favourite" clickable="true" bounds="[0,0][150,150]"',
      ),
    );
    const tree = parseUiTree(xml, {imageWidth: 1080, imageHeight: 2400, densityDpi: 420});
    const image = {width: 1080, height: 2400, data: new Uint8Array(1080 * 2400 * 4).fill(255)};
    // a light grey star on white
    for (let y = 40; y < 110; y++) {
      for (let x = 40; x < 110; x++) {
        image.data.set([215, 215, 215, 255], (y * 1080 + x) * 4);
      }
    }
    const config = structuredClone(DEFAULT_A11Y_CONFIG);
    for (const rule of Object.keys(config.rules)) {
      config.rules[rule].enabled = rule === 'non-text-contrast';
    }
    const [found] = scanScreen(tree, image, config).violations;
    expect(found.rule).toBe('non-text-contrast');
    expect(found.details).toMatchObject({required: 3, foreground: '#d7d7d7'});
  });

  it('uses the configured thresholds and severities, and skips disabled rules', function () {
    const xml = androidScreen(
      node(
        'android.widget.ImageButton',
        'resource-id="x" content-desc="Close" clickable="true" bounds="[0,0][110,110]"',
      ),
    );
    expect(scan(xml).violations.some((v) => v.rule === 'touch-target')).toBe(true);

    const relaxed = mergeConfig({thresholds: {minTargetDp: 40}, rules: {testability: {severity: 'error'}}});
    const tree = parseUiTree(xml, {imageWidth: 1080, imageHeight: 2400, densityDpi: 420});
    const result = scanScreen(tree, undefined, relaxed);
    expect(result.violations.some((v) => v.rule === 'touch-target')).toBe(false);

    const off = mergeConfig({rules: {'touch-target': {enabled: false}}});
    expect(scanScreen(tree, undefined, off).violations.some((v) => v.rule === 'touch-target')).toBe(false);
  });
});

describe('a11y: iOS table cells', function () {
  // shaped like the Settings app: cells are not accessibility elements, their texts are
  const ios = `<AppiumAUT><XCUIElementTypeApplication type="XCUIElementTypeApplication" name="Settings" label="Settings" enabled="true" visible="true" accessible="false" x="0" y="0" width="393" height="852">
    <XCUIElementTypeCell type="XCUIElementTypeCell" name="APPLE_ACCOUNT" enabled="true" visible="true" accessible="false" x="16" y="167" width="361" height="71">
      <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" value="Sign in to your iPhone" name="Sign in to your iPhone" label="Sign in to your iPhone" enabled="true" visible="true" accessible="true" x="112" y="184" width="166" height="21"/>
    </XCUIElementTypeCell>
    <XCUIElementTypeCell type="XCUIElementTypeCell" name="General" label="General" enabled="true" visible="true" accessible="false" x="16" y="351" width="361" height="45">
      <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" value="General" name="General" label="General" enabled="true" visible="true" accessible="true" x="80" y="363" width="60" height="21"/>
      <XCUIElementTypeButton type="XCUIElementTypeButton" name="chevron" label="chevron" enabled="false" visible="true" accessible="false" x="346" y="366" width="11" height="15"/>
    </XCUIElementTypeCell>
    <XCUIElementTypeCell type="XCUIElementTypeCell" name="Siri" label="Siri" enabled="true" visible="false" accessible="false" x="16" y="862" width="361" height="45">
      <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" value="Siri" name="SIRI" label="Siri" enabled="true" visible="false" accessible="true" x="0" y="149" width="98" height="21"/>
    </XCUIElementTypeCell>
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="unreachable" label="Pay" enabled="true" visible="true" accessible="false" x="16" y="500" width="361" height="50"/>
  </XCUIElementTypeApplication></AppiumAUT>`;

  it('reads the texts of a cell VoiceOver does not focus as a whole', function () {
    const tree = parseUiTree(ios, {imageWidth: 1179, imageHeight: 2556});
    const found = scanScreen(tree).violations;
    expect(found.filter((v) => v.rule === 'missing-label')).toEqual([]);
  });

  it('flags only enabled controls VoiceOver cannot reach at all', function () {
    const tree = parseUiTree(ios, {imageWidth: 1179, imageHeight: 2556});
    const found = scanScreen(tree).violations.filter((v) => v.rule === 'not-accessible');
    expect(found.map((v) => v.resourceId)).toEqual(['unreachable']);
  });

  it('ignores stale frames inside rows scrolled away', function () {
    const tree = parseUiTree(ios, {imageWidth: 1179, imageHeight: 2556});
    expect(scanScreen(tree).violations.filter((v) => v.rule === 'hidden-focusable')).toEqual([]);
  });
});

describe('a11y: config', function () {
  it('keeps defaults for anything missing or invalid', function () {
    const config = mergeConfig({
      rules: {
        'missing-label': {severity: 'warning'},
        'no-such-rule': {enabled: false},
        'touch-target': {severity: 'fatal'},
      },
      thresholds: {minContrast: 7, minTargetDp: -1, unknown: 3},
      patterns: {roleWords: '(unclosed'},
      problems: {
        screenTitle: ['id:toolbar_title', ''],
        duplicateModes: {'touch-target': 'component', x: 'bad'},
        classes: [{nope: 1}],
      },
    });
    expect(config.rules['missing-label']).toEqual({enabled: true, severity: 'warning'});
    expect(config.rules['touch-target'].severity).toBe('warning');
    expect(config.rules).not.toHaveProperty('no-such-rule');
    expect(config.thresholds.minContrast).toBe(7);
    expect(config.thresholds.minTargetDp).toBe(48);
    expect(config.patterns.roleWords).toBe(DEFAULT_A11Y_CONFIG.patterns.roleWords);
    expect(config.problems.screenTitle).toEqual(['id:toolbar_title']);
    expect(config.problems.duplicateModes).toEqual({'touch-target': 'component'});
    expect(config.problems.classes).toEqual([]);
    expect(mergeConfig(null)).toEqual(DEFAULT_A11Y_CONFIG);
  });
});

describe('a11y: screen identity', function () {
  const titled = androidScreen(
    node(
      'android.view.ViewGroup',
      'resource-id="com.bank:id/Appbar#Title" bounds="[0,0][1080,150]"',
      node('android.widget.TextView', 'text="Переказ на картку" bounds="[0,0][1080,150]"'),
    ),
  );

  it('reads the title from the Appbar#Title element or the text under it', function () {
    const tree = parseUiTree(titled, {imageWidth: 1080, imageHeight: 2400});
    expect(screenTitle(tree)).toBe('Переказ на картку');
    expect(identifyScreen(tree)).toEqual({
      title: 'Переказ на картку',
      source: 'title-tag',
      key: 'title:переказ на картку',
    });
  });

  it('falls back to the iOS navigation bar, the activity, then the layout', function () {
    const ios = `<AppiumAUT><XCUIElementTypeApplication type="XCUIElementTypeApplication" name="Settings" label="Settings" enabled="true" visible="true" accessible="false" x="0" y="0" width="390" height="844"><XCUIElementTypeNavigationBar type="XCUIElementTypeNavigationBar" name="General" enabled="true" visible="true" accessible="false" x="0" y="47" width="390" height="44"/></XCUIElementTypeApplication></AppiumAUT>`;
    expect(identifyScreen(parseUiTree(ios, {imageWidth: 1170, imageHeight: 2532})).title).toBe('General');

    const plain = parseUiTree(
      androidScreen(
        node('android.widget.Button', 'resource-id="pay" text="Pay" clickable="true" bounds="[0,0][1080,150]"'),
      ),
      {
        imageWidth: 1080,
        imageHeight: 2400,
      },
    );
    expect(identifyScreen(plain, {activity: 'com.bank.ui.PaymentActivity'})).toMatchObject({
      title: 'PaymentActivity',
      source: 'activity',
    });
    const byLayout = identifyScreen(plain);
    expect(byLayout.source).toBe('structure');
    expect(identifyScreen(plain).key).toBe(byLayout.key);
  });
});

describe('a11y: problems and decisions', function () {
  // two screens with the same button component, 34 dp tall, and an unlabeled icon without an id
  const screenWith = (title: string, buttonHeight = 90, extra = '') =>
    androidScreen(
      node(
        'android.widget.TextView',
        `resource-id="com.bank:id/Appbar#Title" text="${title}" bounds="[0,0][1080,150]"`,
      ) +
        node(
          'android.widget.Button',
          `resource-id="Pay#PbButton" text="Pay" clickable="true" bounds="[0,300][1080,${300 + buttonHeight}]"`,
        ) +
        node(
          'android.widget.Button',
          `resource-id="Next#PbButton" text="Next" clickable="true" bounds="[0,600][1080,${600 + buttonHeight}]"`,
        ) +
        node('android.widget.ImageButton', 'clickable="true" bounds="[900,900][1050,1050]"') +
        extra,
    );
  const config = mergeConfig({rules: {testability: {enabled: false}}});
  const review = (xml: string, store = emptyStore(), cfg = config) => {
    const tree = parseUiTree(xml, {imageWidth: 1080, imageHeight: 2400, densityDpi: 420});
    const screen = identifyScreen(tree, {titleSelectors: cfg.problems.screenTitle});
    const context = problemContextOf({config: cfg, appId: 'com.bank', screen});
    return {reviewed: reviewScan(scanScreen(tree, undefined, cfg).violations, store, context), context};
  };
  const touch = (reviewed) => reviewed.open.find((group) => group.rule === 'touch-target');

  it('makes one problem of a component with the same size on a screen and on every other', function () {
    const first = review(screenWith('Payments'));
    const group = touch(first.reviewed);
    expect(group.violations).toHaveLength(2);
    expect(group).toMatchObject({component: 'PbButton', everyScreen: true, key: 'touch-target|c:PbButton|411x34'});
    expect(group.code).toMatch(/^a11y-[0-9a-f]{8}$/);

    const store = decide(
      emptyStore(),
      group,
      {status: 'reported', jiraKey: 'PAY-1', jiraUrl: 'u'},
      'filed',
      first.context,
    );
    const other = review(screenWith('Transfers'), store);
    expect(touch(other.reviewed)).toBeUndefined();
    expect(other.reviewed.reported.find((g) => g.rule === 'touch-target').issue).toMatchObject({
      jiraKey: 'PAY-1',
      decidedOn: 'Payments',
    });
  });

  it('files again when the component is too small by another size, unless sizes do not matter', function () {
    const first = review(screenWith('Payments'));
    const store = decide(
      emptyStore(),
      touch(first.reviewed),
      {status: 'reported', jiraKey: 'PAY-1'},
      'filed',
      first.context,
    );
    // 30 dp instead of 34 dp: another problem
    expect(touch(review(screenWith('Transfers', 80), store).reviewed)).toBeDefined();
    const anySize = mergeConfig({...config, problems: {duplicateModes: {'touch-target': 'component'}}});
    expect(touch(review(screenWith('Transfers', 80), store, anySize).reviewed)).toBeUndefined();
  });

  it('keeps problems of elements without an id to their screen', function () {
    const first = review(screenWith('Payments'));
    const unlabeled = first.reviewed.open.find((group) => group.rule === 'missing-label');
    expect(unlabeled.everyScreen).toBe(false);
    const store = decide(emptyStore(), unlabeled, {status: 'ignored', comment: 'decor'}, 'ignored', first.context);
    expect(review(screenWith('Payments'), store).reviewed.ignored.map((g) => g.rule)).toEqual(['missing-label']);
    expect(review(screenWith('Transfers'), store).reviewed.open.some((g) => g.rule === 'missing-label')).toBe(true);
  });

  it('lets a class ignore what it takes, and lists filed bugs whose problem is gone', function () {
    const decor = mergeConfig({
      ...config,
      problems: {
        classes: [
          {id: 'd', name: 'Decor', rules: ['missing-label'], when: {className: ['*ImageButton']}, action: 'ignore'},
        ],
      },
    });
    const {reviewed} = review(screenWith('Payments'), emptyStore(), decor);
    expect(reviewed.ignored[0].issue).toMatchObject({byClass: 'Decor'});

    const first = review(screenWith('Payments'));
    const store = decide(
      emptyStore(),
      touch(first.reviewed),
      {status: 'reported', jiraKey: 'PAY-1'},
      'filed',
      first.context,
    );
    // the buttons grew to 48 dp: the bug filed from this screen can be closed
    const fixed = review(screenWith('Payments', 126), store);
    expect(fixed.reviewed.resolved.map((problem) => problem.jiraKey)).toEqual(['PAY-1']);
  });

  it('forgets a decision on every screen and remembers the bug as unlinked', function () {
    const first = review(screenWith('Payments'));
    const filed = decide(
      emptyStore(),
      touch(first.reviewed),
      {status: 'reported', jiraKey: 'PAY-1'},
      'filed',
      first.context,
    );
    const again = review(screenWith('Transfers'), filed);
    const group = again.reviewed.reported.find((g) => g.rule === 'touch-target');
    const {store, unlinked} = forget(filed, group, again.context);
    expect(unlinked).toEqual([{jiraKey: 'PAY-1', code: group.code}]);
    expect(store.problems).toEqual([]);
    expect(unlinkedKeys(store)).toEqual(['PAY-1']);
    expect(store.log.map((entry) => entry.action)).toEqual(['filed', 'unlinked']);
  });

  it('reads decisions kept per issue before problems had ids', function () {
    const old = {
      'com.bank::title:payments::touch-target|id:Pay#PbButton': {
        appId: 'com.bank',
        screenKey: 'title:payments',
        screenTitle: 'Payments',
        violationId: 'touch-target|id:Pay#PbButton',
        status: 'reported',
        jiraKey: 'PAY-9',
        at: '2026-10-25T10:00:00.000Z',
      },
    };
    const store = asStore(old);
    expect(store.problems).toHaveLength(1);
    expect(store.problems[0]).toMatchObject({projectId: 'com.bank', jiraKey: 'PAY-9', key: 'touch-target|c:PbButton|'});
  });

  it('merges decisions exported elsewhere, the newer winning', function () {
    const first = review(screenWith('Payments'));
    const group = touch(first.reviewed);
    const mine = decide(emptyStore(), group, {status: 'ignored'}, 'ignored', first.context);
    const theirs = decide(emptyStore(), group, {status: 'reported', jiraKey: 'PAY-2'}, 'filed', first.context);
    theirs.problems[0].updatedAt = '2999-01-01T00:00:00.000Z';
    const merged = importStore(mine, theirs);
    expect(merged.problems).toHaveLength(1);
    expect(merged.problems[0]).toMatchObject({status: 'reported', jiraKey: 'PAY-2'});
    expect(merged.log).toHaveLength(2);
  });
});

describe('a11y: reading order', function () {
  it('skips texts inside a clickable row, which is read as one stop', function () {
    const xml = androidScreen(
      node(
        'android.widget.LinearLayout',
        'resource-id="row" clickable="true" bounds="[0,0][1080,200]"',
        node('android.widget.TextView', 'text="Card" bounds="[0,0][800,200]"'),
      ) + node('android.widget.TextView', 'text="Footer" bounds="[0,500][1080,600]"'),
    );
    const order = readingOrder(parseUiTree(xml, {imageWidth: 1080, imageHeight: 2400}));
    expect(order.map((n) => n.key)).toEqual(['id:row', 'TextView:Footer']);
  });
});
