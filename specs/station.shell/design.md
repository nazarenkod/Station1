# Робоча станція: панель інструментів, шапка, робочий стіл — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [2. Робоча станція](../SPEC.md#shell).

## Де в коді й точка розширення

Панель UI. Код: `app/common/renderer/components/Workstation/` (`tools.js`; `ToolRail.jsx` — панель інструментів біля лівого краю з налаштуваннями внизу; `WorkstationHeader.jsx` — проєкт, пристрій, `StartButton.jsx` — керування тестом: без сесії «Почати сесію» (`startEverything` з `lib/session/start-all.js` — що обрано в `TEST_START`, потім `startQuickSession`; чого бракує — `startProblems` з `app/common/shared/start-problems.js` через `useStartProblems`, пікери обводить `problemFor`), із сесією «Пауза / Продовжити» (`setTestPaused` з `lib/session/test-run.js` → IPC `proxy:setPaused`, `logs:setPaused`, `perf:setPaused`; проксі не записує обмінів, лог не тримає рядків, заміри не беруть зразків) і «Скинути» (`NewTestDialog`, тепер і з замірами — `clearPerf`); `SessionChip.jsx` (сесія, без неї — `JournalDot`: `journalHealth` з `app/common/shared/journal.js`, головний процес шле `journal:health` після кожної пачки записів, `openJournal` позначає побачене), задача; `Workstation.jsx` — шапка, під нею панель, смуга цілей і інструмент з чатом агента), робочий стіл — `app/common/renderer/components/Desk/` (`Desk.jsx`: задача, цілі сесії, знахідки; `NewTestDialog.jsx` — очищення зібраного, дія `A11Y_SCAN_CLEARED` у `reducers/SessionInspector.js`, новий прогін цілей). Вкладка «Station Doctor» (`/station`) — `StationPage.jsx`: `DoctorPanel.jsx` (списки `EnvList`: середовище Mac, сервіси станції, інтеграції — Kiro CLI з них, бо `check.id` на `kiro`) і `doctor-fixes.js` — стан середовища з виправленнями, помилка перевірки стає рядком `doctorFailed`; `DevicesPanel.jsx`. Звіт доктора — у `doctor-store.js`: його читають раз за запуск (з `Workstation.jsx`), тож число на панелі (`doctorProblems` — перевірки й сервер Appium, як рахує панель; колір — `doctorSeverity`) видно й до першого відкриття. Подія `doctor:changed` (після `env_run_fix` агента) перечитує звіт. Доктор перевіряє Appium, який станція запустить (`checkEnvironment({appium})` з `ManagedAppium.resolveBinary`): власний на Node.js застосунку, інакше з PATH; `params.own` каже, який.

«Виправити з оператором» — кнопка в `StatusCard` рядка з проблемою: `fixPrompt` складає промпт з назви, тексту, id перевірки, поради й команди (`deskFixWithAgentPrompt`, `…Advice`, `…Command`, `…Do`), `askOnTask` надсилає його одразу (`whenIdle` чекає кінця ходу, що йде). Команди виправлень — спільні для картки й агента: `app/common/shared/doctor/fix-commands.js` (`COMMANDS`, `commandFor`, `fixKey`, `TERMINAL_ONLY` — ті, що питають пароль чи вхід, агент лише показує).

## Модель даних

Redux-стан `workstation`: пристрої (найуживаніші першими), обраний пристрій, `deviceUse`, застосунки проєкту, застосунок, стан Appium, баги з Jira.

## API, CLI, MCP

Немає: оболонка лише для UI.

## Що зберігає

Налаштування `TEST_START`: `{proxy, logs, perf}` — що запускає «Почати сесію» (заміри вимкнено за замовчуванням: вони навантажують пристрій і не завжди потрібні). Налаштування `WORKSTATION`: обраний пристрій і застосунок, `deviceUse` — скільки разів і коли востаннє використано кожен пристрій (до 50; `app/common/shared/device-use.js`: `noteDeviceUse`, `byUse`; редюсер сортує `devices` за ним).

## Рішення

- **Інструменти — панеллю зліва, а не вкладками в шапці** (2026-10-27): у шапці бракувало місця для пристрою й задачі, підписи вкладок ховалися у вузькому вікні. Панель має сталу ширину й завжди показує підписи.

- **Пауза — у головному процесі, а не у вікні** (2026-10-27): вікно може перезавантажитися, а проксі, лог і заміри живуть у головному процесі; новий лог чи заміри починаються вже на паузі, якщо тест на ній.
- **«Почати сесію» не перемикає пристрій на проксі** (2026-10-27): налаштування проксі пристрою змінює його мережу й має свій відкат; кнопка запускає лише проксі на Mac, лог, заміри й сесію.
- **Назва продукту в `splash.html` текстом** (2026-10-27): заставка показується до будь-якого скрипту, тож назву з `product.js` туди переписують руками.

## Тести

`test/unit/env-tools.spec.js` — інструменти середовища агента й колір числа (`doctorSeverity`); `test/unit/device-use.spec.js` — порядок пристроїв; `test/unit/start-problems.spec.js` — чого бракує для старту; `test/unit/station-journal.spec.js` — точка журналу; решта — немає.
