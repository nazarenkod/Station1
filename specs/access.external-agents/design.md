# Зовнішні агенти — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [11. Доступ: CLI, MCP, API](../SPEC.md#access).

## Де в коді й точка розширення

Тип за документом: інтеграція (доступ).

- `app/common/shared/autotests/external-tools.js` — опис інструментів для мосту (`EXTERNAL_TOOLS`: назва, опис, схема на zod), `limitAnswer` (60 000 символів).
- `app/common/node/autotests/external-run.js` — `externalTools({packages, profiles, masks})`: що інструменти роблять у станції; видача пакета ставить `takenAt`.
- `app/common/node/agent/station-mcp.js` — `createStationMcp({…, external})`: маршрут `POST /external/<tool>` з окремим `externalToken`, лише коли `external.allowed()`; інакше 403. Токен вбудованого агента туди не пускає, а зовнішній — у `/mcp/…` (401).
- `app/common/node/autotests/external.js` — файл підключення `external-agents.json` у теці даних (`writeConnection` з правами 600, `readConnection`, `removeConnection`), `stationDataDir` (як станція: `STATION_DATA_DIR`, macOS `~/Library/Application Support/vision-inspector`), `callStation` — виклик з мосту з поясненнями, коли станції немає чи доступ вимкнено.
- `app/cli/mcp.js` — `vision-inspector mcp` реєструє `EXTERNAL_TOOLS` і передає виклики станції; скриншоти — вміст `image`.
- `app/electron/main/ipc/autotests.js` — `external` для сервера (інструменти, `allowed`, `onAccess` — журнал станції й останнє звернення), `attach({service, mcp})` після агента: файл підключення, коли доступ увімкнено; IPC `autotests:external`, `autotests:setExternal`; файл прибирається на виході.
- `app/electron/main/ipc/agent.js` передає `external` у сервер і повертає `{service, mcp}`; `main.js` ставить автотести перед агентом.
- Вікно: `app/common/renderer/components/Autotests/ExternalAgentsSettings.jsx` — картка в Налаштування → «Оператор» (`AgentSettings.jsx`).

## Модель даних

```
EXTERNAL_AGENTS = {enabled: false, lastAccess: ISO | null, lastTool?: string}
external-agents.json = {port, token, pid}      // лише поки доступ увімкнено, права 600
```

## API, CLI, MCP

- `vision-inspector mcp` (stdio): `autotests_packages {project?}`, `autotests_package_get {package, project?, screen_object?, elements?, screenshots?}` — разом з `doctor`, `audit_screen`, `list_rules`.
- Станція: `POST http://127.0.0.1:<port>/external/<tool>`, `Authorization: Bearer <externalToken>`, тіло — аргументи JSON, відповідь `{ok, text, images?}`.

## Що зберігає

`EXTERNAL_AGENTS` — лише на цьому Mac, не експортується. Файл підключення — у теці даних станції.

## Рішення

- 2026-10-29. Міст — наявний `vision-inspector mcp`, а не окремий прапорець: агент підключає один сервер, а без станції ці два інструменти пояснюють, що зробити.
- 2026-10-29. Інструменти — простий JSON поверх HTTP-сервера станції, а не MCP через міст: міст сам описує їх агенту, а станція лише виконує; так легше пояснити, коли станції немає.
- 2026-10-29. Тимчасовий токен у файлі з правами 600, а не в Keychain: він живе до перезапуску, а Keychain прив'язаний до назви застосунку й мостом не читається.

## Тести

- `test/unit/autotests-external.spec.js` — теку даних, файл підключення, список і пакет через міст, приховування, позначку «забрав», пояснення без станції й при вимкненому доступі, окремі токени (критерії 2–8).
