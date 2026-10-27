# Код застосунку в проєкті — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [15. Агент станції](../SPEC.md#agent).

## Де в коді й точка розширення

- `app/common/shared/settings/source.js` — чисті функції. `projectSource()` чистить код профілю: гілки й репозиторії, роль, перший репозиторій — головний. Є розбір `.gitmodules`, `git submodule status`, `git status --porcelain`, адреси `origin` без логіна й токена, зведення стану репозиторію (`repoWarnings`) і теки для агента (`agentWorkspace`: робоча тека й додаткові).
- `app/common/node/source/repo.js` — git на диску через `run` з `doctor/exec.js`: `inspectRepo`, `listBranches`, `changesToDiscard`, `fetchRepo`, `switchBranch`, `pullRepo`. Git ніколи не питає пароль (`GIT_TERMINAL_PROMPT=0`), кожна команда йде в журнал станції.
- `app/common/shared/settings/profiles.js` — `setProfileSource()`; копія профілю бере його код, новий профіль — гілки за замовчуванням.
- `app/common/node/settings/station-settings.js` — `setProfileSource`, `outline` віддає `source`; шляхи профілю копіюються з копією й видаляються з профілем.
- `app/common/shared/settings/transfer.js` — експорт і імпорт `source` профілю (без шляхів).
- `app/electron/main/ipc/source.js` — IPC `source:pickFolder`, `source:setPath`, `source:inspect`, `source:branches`, `source:preview`, `source:fetch`, `source:switch`, `source:pull`, `source:restoreBranch`; `settings:setProfileSource` — в `ipc/settings.js`. Міст — `backend.source` (`preload.mjs`, `polyfills.js`).
- `app/common/renderer/components/Settings/SourceSettings.jsx` — розділ «Код застосунку» в картці профілю.

## Модель даних

- **Код профілю** — поле профілю `source: {devBranch, releaseBranch, repos: [{id, name, role}]}`; ролі `app`, `android`, `ios`, `backend`, `shared`, `other`. Перший репозиторій — головний: робоча тека агента.
- **Шляхи** — ключ `SOURCE_PATHS`: `{[profileId]: {[repoId]: {path, previousBranch?}}}`. Він не входить у жодну групу, тож не йде ні в експорт, ні в копії налаштувань. `id` репозиторію йде в експорт: імпорт із заміною зберігає шляхи репозиторіїв, що вже були.
- **Стан репозиторію** (не зберігається): `{ok, error?, root, branch, detached, remote, lastFetch, changes: [{repo, path, kind}], submodules: [{name, path, url, initialized}], hasDev, hasRelease}`.

## API, CLI, MCP

Немає. Агенту теки дає `agentWorkspace()` ([agent.core](../agent.core/spec.md), критерій 9).

## Що зберігає

`PROFILES[].source`, `SOURCE_PATHS`. У репозиторії — лише те, що робить git: `fetch`, перемикання, `pull --ff-only`, скидання змін перед перемиканням.

## Рішення

- **Шляхи окремо від профілю** (2026-10-27). Профіль ділиться з командою, а шляхи — лише цього Mac; так їх не треба вирізати з кожного експорту.
- **Скидання — `reset --hard` і `clean -fd`, без `-x`** (2026-10-27). Ігноровані збірки й кеші лишаються, бо їх довго робити знову, а агенту вони не заважають. Так само в кожному завантаженому сабмодулі.
- **Перемикання — `git checkout <гілка>`**, а не `switch`: на деяких Mac ще стоїть git 2.23, де `switch` експериментальний. Гілка, якої немає локально, береться з `origin` з відстеженням. Після нього `submodule update --init --recursive`.
- **«Повернути гілку»** зберігає попередню гілку в `SOURCE_PATHS`. Журнал змін агента з'явиться з [agent.station-mcp](../agent.station-mcp/spec.md), і перемикання підуть туди.
- Адреса `origin` показується без логіна й токена, які бувають в `https://user:token@…`.

## Тести

- `test/unit/project-source.spec.js` — `source.js` і `repo.js` на справжньому тимчасовому репозиторії з сабмодулем.
- `test/unit/settings-backup.spec.js`, `test/unit/settings-profiles.spec.js` — код профілю в експорті, імпорті й копії.
