# Руки агента — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [15. Агент станції](../SPEC.md#agent).

## Де в коді й точка розширення

Тип за документом: дія.

```
 Kiro ─ stdio ─▶ hands-entry.mjs (Electron як Node)
                   appium-mcp/core + плагін станції ── W3C ──▶ Appium станції (сесія інспектора)
                        │ beforeCall: /hands/<розмова>/check   (дозвіл, заборони, сесія, ліміт, «Стоп»)
                        │ afterCall:  /hands/<розмова>/done    (журнал, екрани сесії, коротка відповідь)
                        ▼
                 MCP-сервер станції (127.0.0.1, токен)
```

- `app/common/shared/agent/hands.js` — чисті функції:
  - `HAND_GROUPS`, `groupOf(tool, args)` — група дії за інструментом і `action`;
  - `NEVER_TOOLS`, `allowedTools(permissions)` — що бачить агент (фільтр appium-mcp);
  - `handsVerdict` — рішення для `check`: сесія, «Стоп», ліміт, група, пароль, заборони, збірки;
  - `shortAnswer` — відповідь до 1 000 символів з екраном після дії; `failureHint` — чому дія не вдалася, простими словами; `actionLine` — рядок дії для чату й журналу;
  - `goalsStatus` — цілі сесії для `goals_status`.
- `app/common/node/agent/hands-plugin.mjs` — плагін і точка входу процесу рук. Самодостатній файл (лише Node і `appium-mcp/core` з теки рук): станція пише його в теку рук і передає Kiro як stdio-сервер.
- `app/common/node/agent/hands.js` — керування руками:
  - встановлення `appium-mcp` зафіксованої версії в `<userData>/hands` (`npm install --prefix`), стан для Doctor;
  - сервер для `session/new` (`handsServer`): команда — Electron (`ELECTRON_RUN_AS_NODE=1`), змінні — адреса й токен станції, розмова, фільтр інструментів, `NO_UI`, `APPIUM_MCP_ON_CLIENT_DISCONNECT=skip`, `ALLOW_REMOTE_APP_URLS=false`, `REMOTE_SERVER_URL_ALLOW_REGEX` лише на `127.0.0.1`;
  - стан розмови: лічильник дій за хід, «Стоп», `check` і `done`.
- `app/common/node/agent/station-mcp.js` — маршрути `POST /hands/<розмова>/check|done` з тим самим токеном; те, що лише читає, `done` пропускає через бюджет читання ходу, а приховування робить `hands.done` (`maskText`).
- `app/common/shared/agent/permissions.js` — картки Kiro для сервера `hands`: група «дозволено» — так, «питати» — людина, «заборонено» — ні.
- `app/common/node/agent/service.js` — сервер рук у кожній розмові, коли руки встановлено; новий хід скидає лічильник і «Стоп».
- `app/common/node/agent/hands-tools.js` — `goals_status` (цілі з вікна, `goals-store`) і `builds_list` (`BUILDS_HISTORY` для застосунку сесії).
- Вікно: `app/common/renderer/lib/agent/bridge.js` — `session` (сервер і id сесії), `elementAt` (елемент під точкою), `handsStep` (крок на екранах сесії й свіже джерело); `components/A11yTool/screen-history.js` — крок агента позначено `by: 'agent'`; `components/Agent/HandsBlock.jsx` у `AgentPanel.jsx` — «Оператор керує пристроєм», «Стоп», рядки дій, картки «Ще 60» й OTP (`lib/agent/agent-store.js`: `handsSteps`, `handsCards`, `stopHands`, `answerHandsCard`); `components/Settings/AgentSettings.jsx` — «Руки агента»: встановлення й ліміт.
- IPC: `hands:status`, `hands:install`, `agent:handsStop`, `agent:cardAnswer`; події `agent:handsStep`, `agent:handsMore`, `agent:otp`.

## Модель даних

- Група дії: `look`, `act`, `app`, `install`, `appData`, `device`, `capture`; `never` — сховані завжди.
- Крок рук: `{at, conversation, turn, tool, action, line, element: {text, id}, ok, screenBefore, screenAfter}` — у журналі станції й у вікні.

## API, CLI, MCP

Сервер MCP `hands` для агента (інструменти appium-mcp за фільтром); у станції — `goals_status`, `builds_list`.

## Що зберігає

- `<userData>/hands` — встановлений appium-mcp (~400 МБ разом із драйверами, які в режимі підʼєднання не працюють) і файл плагіна.
- `AGENT_CONFIG.handsLimit` — ліміт дій за хід (60).

## Рішення

- **Окремий процес, а не бібліотека в головному** (2026-10-28, разом з користувачем): DMG не росте на сотні мегабайт, падіння драйвера не чіпає інтерфейс, версію оновлює Doctor, той самий процес згодом отримають зовнішні агенти.
- **Підʼєднання через інструмент appium-mcp**: публічного API підʼєднатися з плагіна немає, тож плагін на кожній дії без потрібної сесії відповідає агенту, з якими `remoteServerUrl` і `sessionId` викликати `appium_session_management action=attach`, і пропускає лише таке підʼєднання.
- **Дозвіл за групами — і в картках Kiro, і в плагіні**: картку Kiro показує до виклику, а `check` ще раз перевіряє групу, заборони й пароль — так обійти не можна навіть із «Завжди».
- **Повний XML ніколи**: `appium_get_page_source` пропускається лише з `selector` чи `pattern`.

## Тести

- `test/unit/agent-hands.spec.js`
- `test/integration/hands-live.spec.js` — наживо: appium-mcp з `HANDS_DIR`, плагін, сервер станції й сесія fake-драйвера Appium (підʼєднання, тап, заборона, сесія живе після відʼєднання). Без `HANDS_DIR` пропускається; `HANDS_NODE` — Electron, щоб запустити руки так, як станція.
