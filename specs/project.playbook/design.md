# Плейбук застосунку — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [15. Агент станції](../SPEC.md#agent).

## Де в коді й точка розширення

Тип за документом: знання й дія.

- `app/common/shared/agent/playbook.js` — чисті функції:
  - `cleanPlaybook` — форма плейбука з типовими дозволами;
  - `loginScreen` — що на екрані за списком елементів: повний вхід, повторний, OTP, не вхід (критерій 4);
  - `forbiddenFor` — чи заборонений елемент чи екран (критерій 10);
  - `playbookSummary` — короткий зміст для інструкцій (критерій 12) і `playbookDetails` для `playbook_get`.
- `app/common/node/agent/device-client.js` — запити W3C до Appium на сесії інспектора: пошук, тап, введення, очищення, джерело екрана, запуск і закриття застосунку, `mobile: clearApp`, `mobile: deepLink`.
- `app/common/node/agent/playbook-tools.js` — інструменти станції `app_login`, `app_reset`, `playbook_get`. Сесію (адресу сервера, id, платформу) дає вікно (`ask('session')`), логін і пароль — сховище ключів.
- `app/electron/main/ipc/agent.js` — підключення інструментів; IPC `playbook:secretState`, `playbook:setSecret` для акаунтів, `playbook:tryLogin` для «Спробувати вхід».
- Вікно: `app/common/renderer/components/Settings/PlaybookSettings.jsx` — картка в Налаштування → «Профілі» (`ProfilesSettings.jsx`); «Взяти з інспектора» бере перший локатор обраного елемента (`selectedElement.strategyMap`), «Перевірити» шукає його драйвером інспектора; картка OTP у чаті — `components/Agent/HandsBlock.jsx`, відповідь через `agent:cardAnswer`.
- `app_login` при OTP чекає на «Готово» до 5 хвилин (`onOtp` → `agent:otp`).

## Модель даних

```
APP_PLAYBOOK = {
  accounts: [{id, name, purpose}],
  login: {android?: Locators, ios?: Locators},     // Locators = {login?, password?, submit?}: {using, value}
  permissions: {look, act, app, install, appData, device, capture},  // 'allow' | 'ask' | 'deny'
  forbidden: [{id, kind: 'text' | 'pattern' | 'id' | 'screen', value, why}],
  reset: {android?: Step[], ios?: Step[]},          // Step = {kind: 'restart' | 'clear' | 'deeplink', url?}
}
```

Елемент екрана для логіки — вузол `parseUiTree` (`app/common/renderer/lib/a11y/ui-tree.ts`, той самий, що в аудиті доступності): `className`, `text`, `label`, `hint`, `resourceId`, `password`, `clickable`, `bounds`, `index`.

## API, CLI, MCP

Інструменти MCP станції: `app_login(account)`, `app_reset()`, `playbook_get(part?)`.

## Що зберігає

- `APP_PLAYBOOK` — профільна група `playbook` (`app/common/shared/settings/groups.js`), йде з експортом.
- Логін і пароль акаунта — `encryptedSecret('PLAYBOOK_ACCOUNT_<id>_ENCRYPTED')`, JSON `{login, password}`. Id акаунта випадковий, тож на іншому Mac після імпорту секрету немає, і станція просить ввести.

## Рішення

- **Вхід робить станція, а не appium-mcp** (2026-10-28): пароль іде з Keychain просто в Appium, повз модель і повз процес рук.
- **Екран входу впізнається за полями** (поле пароля, текстове поле поруч, кнопка), локатори в плейбуку — лише поправка, коли не впізнає.
- **OTP не обробляється**: це умова тесту, тож станція зупиняє вхід і кличе людину.
- **Знання про екрани — у памʼяті агента**, а не в плейбуку: плейбук змінює лише людина.

## Тести

- `test/unit/playbook.spec.js`
