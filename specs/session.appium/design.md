# Вбудований Appium і старт сесії в один натиск — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [3. Пристрій і сесія](../SPEC.md#device); стосується також: [6. Інспектор і автоматизація](../SPEC.md#inspector).

## Де в коді й точка розширення

Дія. Код: `app/common/renderer/components/SessionBuilder/QuickStart.jsx`, `app/common/renderer/actions/Workstation.js` (`ensureAppium`), `app/common/node/device/signing.js`, `app/common/shared/ios/signing.js`.

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
