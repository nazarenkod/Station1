# Робоча станція: вкладки, шапка, робочий стіл — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [2. Робоча станція](../SPEC.md#shell).

## Де в коді й точка розширення

Панель UI. Код: `app/common/renderer/components/Workstation/` (`tools.js`, `ToolTabs.jsx`, `WorkstationHeader.jsx`, `Workstation.jsx`), робочий стіл — `app/common/renderer/components/Desk/` (`Desk.jsx`: задача, цілі сесії, знахідки; `NewTestDialog.jsx` — очищення зібраного, дія `A11Y_SCAN_CLEARED` у `reducers/SessionInspector.js`, новий прогін цілей). Вкладка «Станція» (`/station`) — `StationPage.jsx`: `DoctorPanel.jsx` і `doctor-fixes.js` — стан середовища з виправленнями, помилка перевірки стає рядком `doctorFailed`; `DevicesPanel.jsx`. Звіт доктора — у `doctor-store.js`: його читають раз за запуск (з `Workstation.jsx`), тож бейдж вкладки (`ToolTabs.jsx`, `doctorProblems` — перевірки й сервер Appium, як рахує панель) видно й до першого відкриття.

## Модель даних

Redux-стан `workstation`: пристрої, обраний пристрій, застосунки проєкту, застосунок, стан Appium, баги з Jira.

## API, CLI, MCP

Немає: оболонка лише для UI.

## Що зберігає

Налаштування `WORKSTATION`: обраний пристрій і застосунок.

## Тести

Немає.
