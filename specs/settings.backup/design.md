# Налаштування: профілі проєктів, збереження, експорт та імпорт — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [2. Робоча станція](../SPEC.md#shell).

## Де в коді й точка розширення

Панель UI й дані головного процесу.

- `app/common/shared/settings/groups.js` — групи налаштувань: `scope` (`profile` чи `station`), `read(all)` дає значення групи з ключів налаштувань, `write(value, all)` — патч ключів, `valid(value)` — перевірка типу з файлу. `withoutSecrets` прибирає поля з назвами на кшталт токена, пароля чи ключа (лише в групах `integrations` та `inspector`).
- `app/common/shared/settings/profiles.js` — профілі: перший профіль із поточних налаштувань, перемикання, створення й копія, перейменування, застосунки профілю, видалення, профіль для застосунку.
- `app/common/shared/settings/transfer.js` — файл експорту (`buildExport`), розбір і перевірка (`parseSettingsFile`), зведення змін (`summarizeImport`), імпорт (`applyImport`), резервна копія й відновлення (`buildBackup`, `restoreBackup`).
- `app/common/node/settings/station-settings.js` — усе разом над сховищем налаштувань: читає ключі, пише патчі, тримає копії в теці, чистить старі.
- `app/electron/main/ipc/settings.js` — IPC `settings:profiles`, `settings:switchProfile`, `settings:addProfile`, `settings:renameProfile`, `settings:setProfileApps`, `settings:removeProfile`, `settings:profileForApp`, `settings:export` (діалог збереження), `settings:pickImport` (діалог відкриття й зведення), `settings:applyImport`, `settings:backups`, `settings:restore`; подія `settings:changed` зі списком змінених ключів. Під час запуску — щоденна копія.
- `app/common/renderer/lib/settings/profiles-store.js` — профілі для екранів і перечитування налаштувань інструментами після `settings:changed`: проксі (`reloadProxyConfig`), логи (`loadSavedRules`), доступність (`loadA11ySettings`), збірки (`loadBuildSources`), фільтри, мова; тема — у `ThemeProvider.jsx`.
- `app/common/renderer/lib/settings/saved-view.js`, `views.js` — фільтри проксі й логів у налаштуваннях (`PROXY_VIEW`, `LOGS_VIEW`), запис через 400 мс після зміни; перед перемиканням чи експортом — одразу.
- Інтерфейс: `app/common/renderer/components/Workstation/ProfilePicker.jsx` (шапка), `Workstation.jsx` (`ProfileFollower`: застосунок → профіль), `app/common/renderer/components/Settings/ProfilesSettings.jsx` (розділ «Профілі»), `StationTransfer.jsx` (експорт, імпорт, копії в «Загальні»).

## Модель даних

- **Профіль:** `{id, name, apps: string[], updatedAt, groups: {proxy, logs, filters, a11y, builds, jira}}`.
- **Групи профілю:** `proxy` — `PROXY_CONFIG` без `port`; `logs` — `LOG_RULES_CONFIG`; `filters` — `PROXY_VIEW` і `LOGS_VIEW`; `a11y` — `A11Y_CONFIG` і `A11Y_ISSUE_STATES`; `builds` — `BUILD_JOBS` і `GITLAB_CONFIG.project`; `jira` — `JIRA_CONFIG` без `url` і `email`, `JIRA_MEMORY`.
- **Групи станції:** `general` — мова й тема; `integrations` — сайт і акаунт Jira, сайт GitLab, `AI_CONFIG` без `consent`; `devices` — `IOS_SIGNING` і порт проксі; `inspector` — `SAVED_SESSIONS` без `server`, жести, атрибути, мова кодгену.
- **Файл експорту:** `{format: 'station-settings', version: 1, product, exportedAt, kind: 'profile' | 'all', activeProfile?, station?: {група: значення}, profiles: [{name, apps, groups}]}`.
- **Резервна копія:** `{format, version, product, kind: 'backup', reason, createdAt, station, state: PROFILES}`, з id профілів.

## API, CLI, MCP

Немає.

## Що зберігає

- `PROFILES` — `{activeId, list: [профіль]}`; `PROXY_VIEW`, `LOGS_VIEW` — фільтри.
- Копії — `<тека застосунку>/backups/<ISO-час>-<причина>.json`, причини `daily`, `before-import`, `before-delete`, `before-restore`; 10 щоденних і 10 інших.

## Рішення

- **Налаштування профілю, що увімкнений, живуть у звичних ключах** (2026-10-26). Інструменти читають `PROXY_CONFIG`, `LOG_RULES_CONFIG` тощо як і раніше; перемикання зберігає їх у профіль і записує ключі наступного. Альтернатива — кожен інструмент читає з профілю — зачепила б увесь код і CLI.
- **Список дозволеного, а не заборонене** (2026-10-26). Експорт читає лише групи; секрети, `SESSION_SERVER_PARAMS`, пристрій, історія збірок і пайплайни ні в яку групу не входять, тож не виходять навіть якщо їх додадуть пізніше.
- **Імпорт групи замінює її**, без злиття: копія перед імпортом дає відкат, а злиття правил неочевидне.
- **Копія без секретів** відновлює й збережені сесії без `server`: сервер обирають знову.
- Заголовки й тіла підмін у правилах проксі — текст користувача; токен, вписаний туди, піде з профілем (відкрите питання в spec.md).
- Нативні діалоги файлу — у головному процесі; текст обраного файлу лишається там між зведенням і імпортом.

## Тести

- `test/unit/settings-profiles.spec.js` — профілі.
- `test/unit/settings-backup.spec.js` — експорт, імпорт, копії.
