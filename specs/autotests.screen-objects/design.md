# Screen object з екранів сесії — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [6. Інспектор і автоматизація](../SPEC.md#inspector).

## Де в коді й точка розширення

Тип за документом: дія й звіт (пакет screen object).

Підсумок сесії (вікно):

- `app/common/renderer/lib/autotests/summary-store.js` — зовнішнє сховище підсумку: знімок `screens`/`path` з `screen-history.js` на момент відкриття (нова сесія потім чистить історію, а підсумок лишається); `openSummary`, `offerSummary` (раз для тих самих екранів), `closeSummary`, `summaryContext(store)` — платформа, пристрій, застосунок.
- Звідки відкривається: `SessionInspector/use-inspector.js` (`quitSessionAndReturn`), `Desk/NewTestDialog.jsx` (перед `clearScreenHistory`), кнопка «Для автотестів» у `A11yTool/ScreenStrip.jsx`.
- `app/common/shared/autotests/units.js` — одиниці вибору: `initialUnits` (стан іменованого екрана = одиниця), `setUnit`, `mergeUnits` (лише один екран), `splitUnit`, `uniqueNames`.
- `app/common/renderer/lib/autotests/screen-elements.js` — `screenElements(sourceXML, platform)`: усі вузли дерева, крім кореня; тип, id, текст, опис, `enabled`, дії (`tap`, `type`, `clear`, `check`, `scroll`, `text`, `visible`) і до трьох локаторів генераторами Інспектора (`utils/locator-generation`) у порядку accessibility id → id → UiAutomator / predicate / class chain → XPath.
- `app/common/shared/autotests/screen-objects.js` — `objectName`, `mergeElements` (елемент — за першим локатором, інакше за місцем у дереві; `states` у тих, що не в кожному стані), `elementLine`, `generationPrompt`, `parseGenerated` (рядок `=== Name ===` і блок ```kotlin; один screen object бере єдиний блок).
- `app/common/renderer/components/Autotests/AutotestsSummary.jsx` — бічна панель (`Workstation.jsx`); зберігає через `backend.autotests.save`.

Пакети й генерація (головний процес):

- `app/common/node/autotests/packages.js` — `createPackagesStore(dir)`: `list`, `get`, `save` (скриншоти станів — окремі `.jpg`), `update`, `shot`, `remove`, `removeProject`; id лише `[\w-]`.
- `app/electron/main/ipc/autotests.js` — IPC `autotests:packages | package | shot | save | update | remove | generate`, подія `autotests:changed`. `generate`: стан репозиторію → правила → `generationPrompt` з масками приховування (`AI_CONFIG.maskPatterns`) → `service.generate` → `parseGenerated` → код у пакет.
- `app/common/node/agent/service.js` — `generate({profileId, cwd, prompt, confirmCredits})`: згода профілю й поріг кредитів, як у `prompt`; нова розмова Kiro в репозиторії автотестів без серверів MCP; відповідь збирається з `agent_message_chunk` окремо від чату (у вікно ці оновлення не йдуть); кредити ходу пишуться з профілем. `permission` для такої розмови дозволяє лише те, що `decidePermission` дозволяє сам, решту відхиляє.
- `app/common/node/agent/kiro.js` — старт, що не вдався (Kiro ще не встановлено), не лишає мертвого клієнта: наступний запит запускає процес заново.
- Вікно пакета: `app/common/renderer/components/Autotests/PackageView.jsx` (`useGenerate` — згода, поріг кредитів, чого бракує, відповідь без коду), список — у `AutotestsSettings.jsx`.

## Модель даних

```
Package = {id: 'pk-…', name, createdAt, platform: 'android' | 'ios', device: {name} | null, app: {id, version} | null,
           ready: boolean, takenAt: ISO | null,
           objects: [{id: 'so-…', name, screen, states: [{title, shot: 's-….jpg' | null}],
                      elements: Element[], code: string | null, generatedAt: ISO | null, hint: string | null}]}
Element = {path, type, id, text, description, enabled, actions: string[], locators: [strategy, selector][], states?: string[]}
```

## API, CLI, MCP

Пакети читає агент тестів — [access.external-agents](../access.external-agents/design.md).

## Що зберігає

- `<userData>/autotests/<profileId>/<packageId>/package.json` і `s-….jpg` (зменшені скриншоти станів). Не в налаштуваннях, не в експорті; видаляються з проєктом.
- Нових ключів налаштувань немає (згода й кредити — ті самі, що в агента).

## Рішення

- 2026-10-29. Станція не відбирає елементів: людина прибирає зайве в коді, в іншому процесі (вимога користувача).
- 2026-10-29. Локатори й дії рахує станція кодом Інспектора, модель лише вкладає їх у стиль команди: дешевше й передбачувано.
- 2026-10-29. Генерація — разова розмова Kiro в репозиторії автотестів, а не чат: Kiro сам читає приклади й steering репозиторію, код повертає текстом, у файли не пише.
- 2026-10-29. Знімок екранів береться в момент закриття сесії: нова сесія чистить історію, а підсумок має жити, доки людина не збереже чи не закриє.

## Тести

- `test/unit/autotests-elements.spec.js` — елементи, дії, локатори (критерій 7).
- `test/unit/autotests-screen-objects.spec.js` — назви, об'єднання, одиниці, промпт і приховування, розбір відповіді (критерії 2, 4–6, 10–11).
- `test/unit/autotests-packages.spec.js` — пакети (критерії 8–9), чого бракує (критерій 13).
- `test/unit/agent-sessions.spec.js` — разова розмова і її дозволи (критерії 10–11).
- `test/unit/agent-kiro.spec.js` — Kiro, встановлений після невдалого старту.
