# Репозиторій автотестів у проєкті — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [6. Інспектор і автоматизація](../SPEC.md#inspector).

## Де в коді й точка розширення

Тип за документом: інтеграція (джерело знань для генерації).

- `app/common/shared/autotests/config.js` — `cleanAutotestsConfig` (типовий шлях правил `.station/screen-objects.md`), `insidePath` (лише шлях усередині репозиторію: без `/…`, `C:`, `..`).
- `app/common/node/autotests/repo.js` — `inspectAutotests(folder, config)`: git через `inspectRepo` з `node/source/repo.js`, чи є файл правил і тека прикладів, скільки в ній файлів `.kt`/`.kts`, `missing` (`folder`, `rules`, `examples`); `readRules` (до 64 КБ).
- `app/common/node/settings/station-settings.js` — `autotestsPath` / `setAutotestsPath`; копія проєкту бере теку, видалення її забуває й кличе `onProfileRemoved` (пакети видаляє `ipc/autotests.js`).
- `app/common/shared/settings/groups.js` — група профілю `autotests` (шляхи в експорті, без теки).
- `app/electron/main/ipc/autotests.js` — IPC `autotests:inspect`, `autotests:setPath` для активного проєкту; вибір теки — наявний `source:pickFolder`.
- Міст: `backend.autotests.inspect / setPath` (`preload.mjs`, `polyfills.js`).
- Вікно: `app/common/renderer/components/Autotests/AutotestsSettings.jsx` — картка «Автотести» на сторінці проєкту (`Projects/ProjectsPage.jsx`, лише активний проєкт, як плейбук); фокус з інших екранів — `location.state.focus.field === 'autotests'`.

## Модель даних

```
AUTOTESTS_CONFIG = {rules: '.station/screen-objects.md', examples: ''}   // шляхи всередині репозиторію
AUTOTESTS_PATHS  = {[profileId]: '/Users/…/bank-autotests'}            // тека на цьому Mac
```

## API, CLI, MCP

Немає.

## Що зберігає

- `AUTOTESTS_CONFIG` — налаштування профілю (група `autotests`), іде в експорт.
- `AUTOTESTS_PATHS` — лише на цьому Mac, у жодній групі, не експортується.

## Рішення

- 2026-10-29. Правила лежать у репозиторії автотестів, а не в станції: їх пише й версіонує команда, і їх бачить агент тестів. Станція тримає лише шлях.
- 2026-10-29. Блок лише для активного проєкту: шляхи — живі налаштування профілю, як плейбук.

## Тести

- `test/unit/autotests-packages.spec.js` — `inspectAutotests`, `readRules` (критерії 1–2).
- `test/unit/autotests-screen-objects.spec.js` — `insidePath`, `cleanAutotestsConfig` (критерій 2).
- `test/unit/agent-sessions.spec.js` — разова розмова генерації не пише у файли (критерій 3).
- `test/unit/settings-backup.spec.js` — експорт без теки, копія й видалення проєкту (критерій 4).
