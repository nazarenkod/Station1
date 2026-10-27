# Пристрої: виявлення, пріоритет, застосунок для кожного пристрою — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [3. Пристрій і сесія](../SPEC.md#device).

## Де в коді й точка розширення

Джерело даних. Код: `app/common/node/doctor/devices.js`, `app/common/node/device/apps.js`, `app/common/renderer/actions/Workstation.js`.

Усі інструменти запускає `run()` з `app/common/node/doctor/exec.js` з оточенням login-shell (`shellEnv()`, читається один раз). stdin закрито, тож запит у профілі оболонки отримує порожній ввід; після тайм-ауту вся група процесів отримує SIGKILL, бо інтерактивна оболонка ігнорує SIGTERM. Профіль, що не відповів за 8 с, доктор показує перевіркою `shellEnv`. Список пристроїв, який не вдалося прочитати, лишається попереднім, але вважається завантаженим.

## Модель даних

Пристрій: `id`, `kind` (`android-device`, `android-emulator`, `android-avd`, `ios-simulator`, `ios-device`), `name`, `platformName`, `platformVersion`, `state`, `capabilities`. Застосунок: `id`, `name`, `version`, `build`, `installed`.

## API, CLI, MCP

`vision-inspector doctor` і MCP `doctor` повертають пристрої (access.cli-mcp).

## Що зберігає

`WORKSTATION.appByDevice` — застосунок, обраний на кожному пристрої.

## Тести

- `test/unit/doctor.spec.js`
- `test/unit/workstation-app.spec.js`
- `test/unit/workstation-backend.spec.js`
