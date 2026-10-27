# Журнал станції — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [2. Робоча станція](../SPEC.md#shell).

## Де в коді й точка розширення

Джерело даних і панель UI.

- `app/common/shared/journal.js` — чисті функції: сховище записів з лімітом (`createJournal`), маскування секретів (`redact`), опис команди й її результату, фільтр, текст для копіювання й файлу.
- `app/common/node/journal.js` — один журнал на процес (`journal`), зведення (`setSummary`), файл поточного й попереднього запуску (`startJournalFile`, `readPreviousJournal`). CLI теж пише сюди, але лише в пам'ять.
- `app/common/node/doctor/exec.js` — `run()` пише кожну команду: запис з'являється на старті зі станом «виконується» й закривається результатом. `readShellEnv()` кладе в зведення оболонку, час і PATH.
- `app/electron/main/journal.js` — `setupJournal()`: файл у теці даних, зведення про застосунок, помилки головного процесу (`uncaughtExceptionMonitor`, не змінює поведінку падіння), перехоплення `ipcMain.handle` (кожен обробник, зареєстрований після нього, пишеться: канал, тривалість, помилка чи `{ok: false, error}`), IPC журналу й надсилання змін у вікно журналу пачками раз на 250 мс.
- `app/electron/main/ipc/doctor.js` — зміни стану сервера Appium.
- `app/electron/main/windows.js` — `openJournalWindow()`: одне вікно, `journal.html`; друге натискання, поки вікно створюється, нового не робить. `app/electron/main/menus.js` — «Допомога → Журнал станції», ⌥⌘L.
- `app/common/journal.html`, `app/common/renderer/journal.jsx` — окремий вхід інтерфейсу (у `electron.vite.config.mjs`).
- `app/common/renderer/components/Journal/` — `JournalWindow.jsx`, `journal-store.js` (зовнішнє сховище з `useSyncExternalStore`), `Journal.module.css`.
- Помилки інтерфейсу: `app/common/renderer/index.jsx` (`error`, `unhandledrejection`) і `ErrorBoundary.jsx` (`componentDidCatch`) надсилають їх через `backend.journal.report`.

IPC: `journal:list`, `journal:previous`, `journal:clear`, `journal:save`, `journal:report` (send), подія `journal:changed`. Міст — `window.electronIPC.journal`, у інтерфейсі `backend.journal`.

## Модель даних

Запис: `id`, `time`, `level` (`error`, `warn`, `info`, `debug`), `source` (`command`, `ipc`, `appium`, `proxy`, `ui`, `station`), `text`, `detail`, `state` (`running`, `done`), `duration` у мс. Канали `proxy:*` мають джерело `proxy`, `doctor:server:*` — `appium`. Успішний виклик IPC — `debug`, невдала чи завершена тайм-аутом команда — `warn` чи `error`.

Зведення: `app`, `version`, `os`, `arch`, `electron`, `node`, `shell`, `shellEnv` (`ok`, `ms`, `timedOut`), `path`, `androidHome`, `javaHome`, `startedAt`.

Записи живуть у головному процесі (до 5000, старіші витісняються, ті, що виконуються, — ні). Вікно журналу тримає копію у своєму сховищі.

## API, CLI, MCP

Немає.

## Що зберігає

`~/Library/Application Support/vision-inspector/journal/current.jsonl` і `previous.jsonl`: на старті поточний стає попереднім. Рядок — зведення чи запис; запис, що виконувався, пишеться двічі (початок і кінець), тож у попередньому запуску видно, що не завершилося. Файл до 20 МБ, далі не дописується. Уже замасковано.

## Рішення

- 2026-10-27. Окреме вікно, а не вкладка: має працювати, коли головне вікно зависло.
- 2026-10-27. Перехоплення `ipcMain.handle` в одному місці замість правок у кожному `ipc/*.js`: нові обробники потрапляють у журнал самі. Часті й неважливі канали (`settings:get`, `settings:has`, `journal:*`) не пишуться.
- 2026-10-27. Аргументи й відповіді IPC не пишуться взагалі: так простіше, ніж вирішувати, що в них секрет.

## Тести

- `test/unit/station-journal.spec.js` — критерії 2, 3, 4, 6, 7, 8, 9.
