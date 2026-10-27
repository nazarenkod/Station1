# Робоча станція: вкладки, шапка, робочий стіл — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [2. Робоча станція](../SPEC.md#shell).

## Де в коді й точка розширення

Панель UI. Код: `app/common/renderer/components/Workstation/` (`tools.js`, `ToolTabs.jsx`, `WorkstationHeader.jsx`, `Workstation.jsx`), робочий стіл — `app/common/renderer/components/Desk/` (`Desk.jsx`; `DoctorPanel.jsx` і `doctor-fixes.js` — стан середовища з виправленнями, помилка перевірки стає рядком `doctorFailed`; `DevicesPanel.jsx`; `NewTestDialog.jsx` — очищення зібраного, дія `A11Y_SCAN_CLEARED` у `reducers/SessionInspector.js`).

## Модель даних

Redux-стан `workstation`: пристрої, обраний пристрій, застосунок, нещодавні застосунки, застосунок для кожного пристрою, стан Appium, баги з Jira.

## API, CLI, MCP

Немає: оболонка лише для UI.

## Що зберігає

Налаштування `WORKSTATION`: обраний пристрій, застосунок, нещодавні застосунки, застосунок для кожного пристрою.

## Тести

Немає.
