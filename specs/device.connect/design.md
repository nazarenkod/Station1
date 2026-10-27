# Пристрої: виявлення, пріоритет, застосунок проєкту на пристрої — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [3. Пристрій і сесія](../SPEC.md#device).

## Де в коді й точка розширення

Джерело даних. Код: `app/common/node/doctor/devices.js`, `app/common/node/device/apps.js`, `app/common/renderer/actions/Workstation.js`.

Усі інструменти запускає `run()` з `app/common/node/doctor/exec.js` з оточенням login-shell (`shellEnv()`, читається один раз). stdin закрито, тож запит у профілі оболонки отримує порожній ввід; після тайм-ауту вся група процесів отримує SIGKILL, бо інтерактивна оболонка ігнорує SIGTERM. Профіль, що не відповів за 8 с, доктор показує перевіркою `shellEnv`. Список пристроїв, який не вдалося прочитати, лишається попереднім, але вважається завантаженим.

Назва Android-пристрою — `androidDeviceName()`: AVD емулятора з `adb emu avd name` (консоль без токена відповідає `KO`) або з `ro.boot.qemu.avd_name`, для телефона `ro.product.marketname`, інакше `ro.product.manufacturer` і модель з `adb devices -l`. Рядок під назвою (`deviceSubtitle()` у `DevicePicker.jsx`) для `android-device` і `android-emulator` додає `id` — серійний номер adb.

Застосунок — `appForProject({projectApps, platform, installed, current})` в `actions/Workstation.js` із `workstation.projectApps` (`[{id, platform}]`, settings.backup). Платформу пристрою дає `devicePlatform()` (`platformName` малими літерами: `android`, `ios`); застосунки іншої платформи відкидаються, `platform: null` підходить обом. Застосунки кладе `setProjectApps()`, яку викликає `ProjectAppsFollower` у `Workstation.jsx`, коли вмикається профіль чи змінюються його застосунки; `refreshApps()` обирає застосунок знову, коли поточного на пристрої немає або коли це застосунок проєкту іншої платформи (навіть без списку застосунків). Застосунок збірки (`actions/Builds.js`) обирає `selectApp()` напряму.

## Модель даних

Пристрій: `id`, `kind` (`android-device`, `android-emulator`, `android-avd`, `ios-simulator`, `ios-device`), `name`, `platformName`, `platformVersion`, `state`, `capabilities`. Застосунок: `id`, `name`, `version`, `build`, `installed`.

## API, CLI, MCP

`vision-inspector doctor` і MCP `doctor` повертають пристрої (access.cli-mcp).

## Що зберігає

`WORKSTATION`: `deviceId` і `app` — обраний пристрій і застосунок. Старі `recentApps` і `appByDevice` у збережених налаштуваннях більше не читаються.

## Тести

- `test/unit/doctor.spec.js`
- `test/unit/workstation-app.spec.js`
- `test/unit/workstation-backend.spec.js`
