# Агент на Kiro — як зроблено

> Дизайн до контракту [spec.md](spec.md). Частина [основної специфікації](../SPEC.md), розділ [15. Агент станції](../SPEC.md#agent).

## Де в коді й точка розширення

Головний процес:

- `app/common/node/agent/acp-client.js` — JSON-RPC 2.0 через stdin/stdout дочірнього процесу, по повідомленню на рядок. Запити агента до клієнта отримують відповідь обробника або помилку `-32601`, ніколи тишу.
- `app/common/node/agent/kiro.js` — `KiroAgent`: процес `kiro-cli acp --agent-engine=v3 --auth-method=cli`, `initialize`, `session/new` і `session/load` (теки й сервери щоразу заново), `session/prompt`, `session/cancel`, `session/set_config_option`, `_kiro/account/getUsage`. Після кожного `session/new` і `session/load` вимикає `contentCollection`. `kiroProblem()` зводить помилку до слова: `missing`, `login`, `credits`, `network`, `stopped`, `other`.
- `app/common/node/agent/service.js` — `createAgentService()`, головна логіка:
  - яка розмова в профілю й задачі: поточна, завантажена знову або нова;
  - що відкриває розмова: `cwd` — репозиторій (або тека станції), `additionalDirectories` — сабмодулі, інші репозиторії й тека станції; сервери — `station` першим, потім сервери станції й профілю з секретами з Keychain;
  - steering-файл інструкцій у теці станції;
  - дозвіл профілю й денний поріг перед ходом;
  - кредити ходу в журнал;
  - відповідь на запити дозволу (`permissions.js`), а решту питає в людини.
- `app/common/node/agent/credits-store.js` — журнал кредитів у файлі.
- `app/common/node/agent/kiro-doctor.js` — перевірка для доктора: `kiro-cli --version`, `acp --help` (є `v3`), `whoami`; підключено в `doctor/environment.js`.
- `app/common/node/agent/mcp-test.js` — «Перевірити» сервер MCP: SDK-клієнт (HTTP чи stdio) з авторизацією, `tools/list`.
- `app/electron/main/ipc/agent.js` — збирає все разом. IPC `agent:*`; міст до вікна `agent:ask` / `agent:answer`; картки дозволу `agent:permission` / `agent:permissionAnswer`; секрети серверів `AGENT_MCP_<id>_ENCRYPTED`; Kiro зупиняється в `before-quit`.

Спільне (`app/common/shared/agent/`):

- `acp-events.js` — чат із `session/update`: текст, виклики інструментів (сервер, назва, скільки символів повернули), хід із кредитами (`promptTurnSummaries[unit=credit].usage`), часом і даними станції, заповнення контексту й що його займає.
- `context.js` — чипи й блок `<station-context>` перед повідомленням.
- `credits.js` — журнал, суми (сьогодні, тиждень, розмова, задача, профіль), поріг, формат «0,06».
- `conversations.js` — мапа «профіль → задача → сесія Kiro» з власним id розмови станції.
- `instructions.js` — типові інструкції станції (англійською, для агента) і steering-документ із трьох шарів.
- `mcp-servers.js` — сервери MCP: чистка, приховані поля (`hidden`, не `secret`: експорт прибирає поля з такою назвою), формат ACP, стан із `_kiro/mcp/status`.
- `permissions.js` — що станція відповідає сама: читання станції — так; shell, що лише читає, — так; запис файлів і shell, що змінює, — ні; решта — людині.

Вікно:

- `app/common/renderer/lib/agent/agent-store.js` — стан чату (зовнішнє сховище), надсилання, дозвіл, поріг, відкат, «Читати далі».
- `app/common/renderer/lib/agent/bridge.js` — відповідає головному процесу: стан (вкладка, пристрій, застосунок, екран), стиснуте дерево, шлях сесії, знахідки доступності.
- `app/common/renderer/lib/agent/selection.js`, `picks.js` — що обрано у вкладках (вкладка, запит, рядок логу).
- `app/common/renderer/components/Agent/` — панель чату (`AgentPanel.jsx`), безпечний показ Markdown (`AgentText.jsx`).
- `app/common/renderer/components/Settings/AgentSettings.jsx` — розділ «Агент».
- Кнопка в шапці — `WorkstationHeader.jsx`; ⌘J, вкладка в чипі, зміна профілю — `AgentFollower` у `Workstation.jsx`.

## Модель даних

- `AGENT_CONFIG` (станція, група експорту `agentStation`): `{stationInstructions: null | текст, personalInstructions, mcpServers, readBudget, deepBudget, dailyCreditLimit}`.
- `AGENT_PROJECT` (профіль, група `agent`): `{instructions, mcpServers}`.
- `AGENT_CONSENT` (лише цей Mac): `{profiles: {[profileId]: true}, confirmedDay}`.
- `AGENT_SESSIONS` (лише цей Mac): `{[profileId]: {current: {[задача | '_general']: sessionId}, list: [{sessionId, conversation, key, title, createdAt, updatedAt}]}}`.
- Сервер MCP: `{id, name, kind: 'http' | 'stdio', url, headers: [{id, name, value, hidden}], command, args, env, oauth, enabled}`.

## Що зберігає

- `<userData>/agent/workspace/.kiro/steering/station.md` — інструкції, переписуються, коли змінилися.
- `<userData>/agent/credits.json` — журнал кредитів, до 20 000 ходів.
- Розмови зберігає Kiro (`~/.kiro`). Після `session/load` Kiro надсилає історію знову, і вікно будує з неї чат.

## Рішення

- **ACP, а не `chat --no-interactive`** (2026-10-27). Потік, інструменти, дозволи, сесії, метеринг є лише там.
- **Інструкції — steering у теці станції, а теку додано до `additionalDirectories`** (2026-10-27). Перевірено: Kiro читає `AGENTS.md` і steering і з робочої теки, і з додаткової. Нічого не пишеться в репозиторій і в `~/.kiro`.
- **`contentCollection` вимкнено в кожній розмові** (2026-10-27). За замовчуванням Kiro його вмикає, а дані проєкту банківські.
- **Дозволи вирішує станція, не підказки MCP.** Для інструментів станції станція знає, які з них лише читають; `readOnlyHint` — лише для показу.
- **Номер ходу для журналу змін** веде головний процес (`turnOf`). Вікно перед надсиланням питає номер наступного ходу й прив'язує до нього рядок ходу, щоб «Відкотити все за хід» знало, що відкочувати.
- **Вибір моделі й зусилля не зроблено.** Kiro V3 на плані Free не пропонує `model` чи `effortLevel` серед `configOptions`; з'явиться, коли Kiro дасть.

## Тести

- `test/unit/agent-acp.spec.js` — чат із подій, з'єднання ACP, дозволи, `kiroProblem`.
- `test/unit/agent-sessions.spec.js` — мапа розмов, сервіс: нова розмова, повторне завантаження, втрачена сесія, дозвіл, довідка, поріг, кредити.
- `test/unit/agent-credits.spec.js`, `test/unit/agent-context.spec.js`, `test/unit/agent-profile.spec.js`, `test/unit/agent-mcp.spec.js`, `test/unit/doctor.spec.js`.
- Наживо (27.10.2026): дозвіл профілю, `station_state` без питань, 0,15 кр. за хід, картка дозволу `proxy_mock_set`, підміна в налаштуваннях і її відкат, план Kiro в налаштуваннях.
