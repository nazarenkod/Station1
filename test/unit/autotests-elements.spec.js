import {describe, expect, it} from 'vitest';

import {screenElements} from '../../app/common/renderer/lib/autotests/screen-elements.js';

const ANDROID = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <android.widget.FrameLayout class="android.widget.FrameLayout" package="ua.bank" enabled="true" clickable="false">
    <android.widget.TextView class="android.widget.TextView" text="Вхід" resource-id="ua.bank:id/title" enabled="true" clickable="false"/>
    <android.widget.EditText class="android.widget.EditText" text="" resource-id="ua.bank:id/phone" enabled="true" clickable="true"/>
    <android.widget.CheckBox class="android.widget.CheckBox" text="Запам'ятати" checkable="true" clickable="true" enabled="true"/>
    <android.widget.Button class="android.widget.Button" text="Далі" content-desc="next" enabled="false" clickable="true"/>
    <android.view.View class="android.view.View" enabled="true" clickable="false"/>
  </android.widget.FrameLayout>
</hierarchy>`;

const IOS = `<?xml version="1.0" encoding="UTF-8"?>
<XCUIElementTypeApplication type="XCUIElementTypeApplication" name="Bank">
  <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="title" label="Вхід" enabled="true"/>
  <XCUIElementTypeSecureTextField type="XCUIElementTypeSecureTextField" name="password" enabled="true"/>
  <XCUIElementTypeButton type="XCUIElementTypeButton" name="next" label="Далі" enabled="true"/>
</XCUIElementTypeApplication>`;

describe('screenElements', () => {
  it('takes every element of the screen, containers too, but not the root', () => {
    const elements = screenElements(ANDROID, 'android');
    expect(elements.map((element) => element.type)).toEqual([
      'FrameLayout',
      'TextView',
      'EditText',
      'CheckBox',
      'Button',
      'View',
    ]);
  });

  it('says what a test can do with each element on Android', () => {
    const byType = Object.fromEntries(screenElements(ANDROID, 'android').map((element) => [element.type, element]));
    expect(byType.EditText.actions).toEqual(['tap', 'type', 'clear', 'text', 'visible']);
    expect(byType.CheckBox.actions).toEqual(['tap', 'check', 'text', 'visible']);
    expect(byType.Button).toMatchObject({enabled: false, description: 'next', text: 'Далі'});
    expect(byType.View.actions).toEqual(['visible']);
  });

  it('gives the best locators first, at most three', () => {
    const [, title, , , button] = screenElements(ANDROID, 'android');
    expect(title.locators[0]).toEqual(['id', 'ua.bank:id/title']);
    expect(button.locators[0]).toEqual(['accessibility id', 'next']);
    expect(button.locators.length).toBeLessThanOrEqual(3);
    expect(button.locators.map(([strategy]) => strategy)).toContain('-android uiautomator');
  });

  it('reads iOS elements by their type, name and label', () => {
    const [title, password, next] = screenElements(IOS, 'ios');
    expect(title).toMatchObject({type: 'StaticText', id: 'title', text: 'Вхід', actions: ['text', 'visible']});
    expect(password.actions).toEqual(['type', 'clear', 'visible']);
    expect(next.actions).toEqual(['tap', 'text', 'visible']);
    expect(next.locators[0]).toEqual(['accessibility id', 'next']);
    expect(next.locators.map(([strategy]) => strategy)).toContain('-ios predicate string');
  });

  it('gives nothing for an empty source', () => {
    expect(screenElements('', 'android')).toEqual([]);
  });
});
