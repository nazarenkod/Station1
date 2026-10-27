# Робоча станція: панель інструментів, шапка, робочий стіл — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [2. Робоча станція](../SPEC.md#shell).

## Де в коді й точка розширення

Панель UI. Код: `app/common/renderer/components/Workstation/` (`tools.js`; `ToolRail.jsx` — панель інструментів біля лівого краю з налаштуваннями внизу; `WorkstationHeader.jsx` — проєкт, пристрій, Appium, задача; `Workstation.jsx` — шапка, під нею панель, смуга цілей і інструмент з чатом агента), робочий стіл — `app/common/renderer/components/Desk/` (`Desk.jsx`: задача, цілі сесії, знахідки; `NewTestDialog.jsx` — очищення зібраного, дія `A11Y_SCAN_CLEARED` у `reducers/SessionInspector.js`, новий прогін цілей). Вкладка «Станція» (`/station`) — `StationPage.jsx`: `DoctorPanel.jsx` і `doctor-fixes.js` — стан середовища з виправленнями, помилка перевірки стає рядком `doctorFailed`; `DevicesPanel.jsx`. Звіт доктора — у `doctor-store.js`: його читають раз за запуск (з `Workstation.jsx`), тож число на панелі (`doctorProblems` — перевірки й сервер Appium, як рахує панель; колір — `doctorSeverity`) видно й до першого відкриття. Подія `doctor:changed` (після `env_run_fix` агента) перечитує звіт. Доктор перевіряє Appium, який станція запустить (`checkEnvironment({appium})` з `ManagedAppium.resolveBinary`): власний на Node.js застосунку, інакше з PATH; `params.own` каже, який.

«Виправити з агентом» — кнопка в `StatusCard` рядка з проблемою: `askOnTask` з назвою, текстом і id перевірки (`deskFixWithAgentPrompt`). Команди виправлень — спільні для картки й агента: `app/common/shared/doctor/fix-commands.js` (`COMMANDS`, `commandFor`, `fixKey`, `TERMINAL_ONLY` — ті, що питають пароль чи вхід, агент лише показує).

## Модель даних

Redux-стан `workstation`: пристрої, обраний пристрій, застосунки проєкту, застосунок, стан Appium, баги з Jira.

## API, CLI, MCP

Немає: оболонка лише для UI.

## Що зберігає

Налаштування `WORKSTATION`: обраний пристрій і застосунок.

## Рішення

- **Інструменти — панеллю зліва, а не вкладками в шапці** (2026-10-27): у шапці бракувало місця для пристрою й задачі, підписи вкладок ховалися у вузькому вікні. Панель має сталу ширину й завжди показує підписи.

## Тести

`test/unit/env-tools.spec.js` — інструменти середовища агента й колір числа (`doctorSeverity`); решта — немає.
