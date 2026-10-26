# Інспектор: екран, стеження за пристроєм, екрани сесії — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [6. Інспектор і автоматизація](../SPEC.md#inspector); стосується також: [4. Телеметрія](../SPEC.md#telemetry).

## Де в коді й точка розширення

Джерело даних (екрани) і панель UI. Код: `app/common/renderer/components/SessionInspector/`, `app/common/renderer/components/A11yTool/` (`ScreenStrip.jsx`, `screen-follower.js`, `screen-signature.js`, `screen-history.js`, `screen-recorder.js`).

## Модель даних

Screen: ключ, назва, джерело назви, мініатюра, дерево й скриншот (останні), оцінка, лічильники, відвідини, час. До 40 екранів на сесію, лише в пам'яті.

## API, CLI, MCP

MCP `audit_screen` перевіряє поточний екран сесії (access.cli-mcp). Стрічки екранів через CLI чи MCP немає.

## Що зберігає

Стрічка екранів живе лише до кінця сесії.

## Тести

- `test/unit/a11y-screens.spec.js`
- `test/unit/utils-*.spec.js`
- `test/unit/utils-locator-generation/`
