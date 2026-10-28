# Вбудований Appium і старт сесії в один натиск — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [3. Пристрій і сесія](../SPEC.md#device); стосується також: [6. Інспектор і автоматизація](../SPEC.md#inspector).

## Де в коді й точка розширення

Дія. Код: `app/common/renderer/components/SessionBuilder/QuickStart.jsx`, `app/common/renderer/actions/Workstation.js` (`ensureAppium`), `app/common/node/device/signing.js`, `app/common/shared/ios/signing.js`.

Підʼєднання до наявної сесії (критерії 6, 12): `app/common/renderer/lib/session/quick-session.js` — `sessionsOnDevice` читає `/appium/sessions` сервера на `127.0.0.1` (у нашого Appium це вмикає `session_discovery`), `liveSessionChoice` вирішує: та сама програма — підʼєднатися, інша — спитати через `decide`. Питання — `app/common/renderer/lib/session/use-join-session.js` (діалог без закриття клавішею: «нова» завершує стару на нашому Appium). Підʼєднання йде через `newSession(null, id)` upstream Inspector, той ставить `attached` у стан інспектора (`reducers/SessionInspector.js`), а `quitSession` для такої сесії лише відʼєднується.

## Модель даних

Session (сесія Appium): можливості, сервер, драйвер.

## API, CLI, MCP

MCP `doctor` показує сервери Appium з їхніми сесіями. Старту сесії через CLI чи MCP немає.

## Що зберігає

`IOS_SIGNING`: команда розробника й bundle id WebDriverAgent.

## Тести

- `test/unit/doctor.spec.js`
- `test/unit/ios-signing.spec.js`
- `test/unit/quick-start.spec.js`
- `test/unit/session-error-hint.spec.js`
