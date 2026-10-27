# Інструменти станції для агента — як зроблено

> Дизайн до контракту [spec.md](spec.md). Частина [основної специфікації](../SPEC.md), розділ [15. Агент станції](../SPEC.md#agent).

## Де в коді й точка розширення

- `app/common/node/agent/station-mcp.js` — `createStationMcp({tools, onEvent})`: HTTP-сервер на `127.0.0.1:0`, токен на запуск (порівняння `timingSafeEqual`), адреса `/mcp/<розмова>`. На кожен запит — новий `McpServer` зі `StreamableHTTPServerTransport` без сесій. Інструмент читання віддає дані, а що піде назад, вирішує бюджет розмови. Інструмент змін віддає свій текст. Помилка інструмента стає відповіддю з `isError`, а не обривом.
- `app/common/node/agent/tools.js` — `stationTools(deps)`, усі інструменти. Нові інструменти (задача, памʼять, цілі) додаються сюди ж своїми фічами.
- `app/common/node/agent/env-tools.js` — `envTools(deps)`: `env_check` і `env_run_fix` над доктором ([station.shell](../station.shell/design.md)); залежності (`checkEnvironment`, Appium, login shell, `doctor:changed`) дає `ipc/agent.js` з того, що повертає `setupDoctorIPC`.
- `app/common/node/agent/changes.js` — `createChangeJournal`: зміна налаштування з `before` і `after`; `note` для змін поза налаштуваннями (перемикання гілки) з власним `revert`; `undo` і `undoTurn` з перевіркою ручних змін.
- `app/common/shared/agent/station-tools.js` — чисті функції над даними: `trafficStats`, `trafficSearch`, `trafficGet` (з `fields`), `logsStats`, `logsSearch`, `findingsList`, `changeMock`, `changeTrafficRules`, `changeLogRules`, `changeView`.
- `app/common/shared/agent/budget.js` — `capText`, `createReadBudget` (хід, глибокий хід, «без змін з ходу N», `extend`).
- `app/common/shared/agent/privacy.js` — маски: заголовки за назвою, JSON-поля з токенами й паролями, шаблони ШІ для персональних даних.
- `app/common/shared/agent/screen.js` — `compactTree`, `compactFlow`.
- Дані: трафік і лог — знімки з `ipc/proxy.js` і `ipc/logs.js` (їхні `setup*IPC` повертають `snapshot()`). Екран, шлях, вкладка й знахідки доступності — з вікна через `agent:ask` (`renderer/lib/agent/bridge.js`).

## Інструменти

| Інструмент | Читає чи змінює | Що |
|---|---|---|
| `station_state` | читає | профіль, вкладка, пристрій, застосунок, Appium, проксі, лог, екран |
| `traffic_stats`, `traffic_search`, `traffic_get` | читає | трафік проксі |
| `logs_stats`, `logs_search` | читає | лог пристрою |
| `findings_list` | читає | знахідки проксі, логів, доступності |
| `screen_current`, `screen_flow` | читає | екран і шлях сесії |
| `settings_get` | читає | `proxy`, `logs`, `proxyView`, `logsView` без секретів |
| `proxy_mock_set`, `proxy_rule_set`, `log_rule_set`, `view_set` | змінює | `PROXY_CONFIG`, `LOG_RULES_CONFIG`, `PROXY_VIEW`, `LOGS_VIEW` через журнал |
| `repo_fetch`, `repo_checkout`, `repo_pull` | змінює | git з [project.source](../project.source/design.md); `repo_checkout` має `preview` — що буде скинуто |
| `env_check` | читає | `checkEnvironment` доктора з командами з `shared/doctor/fix-commands.js` |
| `env_run_fix` | змінює | відоме виправлення перевірки: `installDriver` / `install` Appium зі `setupDoctorIPC`, інакше команда в login shell (тайм-аут 15 хв); `preview` — команда для картки дозволу; потім `doctor:changed` |

## Що зберігає

Нічого на диску. Бюджети й журнал змін живуть у памʼяті до кінця запуску станції.

## Рішення

- **Зміни — через налаштування й `settings:changed`** (2026-10-27). Інструмент пише ключ, журнал розсилає `settings:changed`, і вікно перечитує інструменти тим самим шляхом, що й після перемикання профілю (`profiles-store.reloadTools`). Окремого коду змін для агента немає.
- **Немає загального `settings_set`.** Кожен інструмент змінює лише свій ключ, тож до секретів, серверів Appium, MCP, дозволів та інструкцій інструменти не дістають за будовою.
- **Розмір виклику в чаті рахується з відповіді, яку бачить Kiro** (`tool_call_update.content`), а не на сервері. Так видно й вбудовані інструменти Kiro.
- **«Читати далі»** розширює бюджет поточної розмови й надсилає агенту коротке повідомлення продовжити.
- Ліміти: `station_state` ≈ 1 000, тіло запиту 4 000, дерево 6 000, відповідь 8 000, хід 40 000, глибокий хід 200 000 символів (два останні — у налаштуваннях агента).

## Тести

- `test/unit/station-mcp.spec.js` — трафік, лог, знахідки, екран, бюджет, маски, зміни; сервер: 401 без токена, інструменти через SDK-клієнт, зміна через журнал, помилка інструмента.
- `test/unit/agent-changes.spec.js` — журнал і відкат.
- `test/unit/env-tools.spec.js` — `env_check` і `env_run_fix`: команда в `preview`, драйвер через Appium станції, нічого для перевірок «лише в терміналі».
