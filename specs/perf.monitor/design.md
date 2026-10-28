# Профілювання застосунку — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [4. Телеметрія](../SPEC.md#telemetry).

Описано крок 1 (метрики наживо, перезапуски, тип збірки, сесія й екрани на графіку) і крок 2 (прогони, еталони, аномалії, допуски проєкту).

## Де в коді й точка розширення

Джерело даних (метрики процесу) і панель UI.

- `app/common/shared/perf/parsers.js` — чисті розбори виводу інструментів: `/proc/stat`, `/proc/<pid>/stat`, `ps -A` (процеси застосунку), `dumpsys meminfo`, `dumpsys package` (DEBUGGABLE), `launchctl list` симулятора, `ps` і `footprint` Mac, ентайтлменти (`get-task-allow`).
- `app/common/shared/perf/series.js` — CPU з двох замірів, межа ряду, переходи процесів (старт і завершення), відрізки екранів і зведення відрізка.
- `app/common/shared/perf/perf-rules.js` — знахідки збору без еталона (критерій 19): `perfFindings` (`perf-cpu-high`, `perf-memory-growth`) з порогами `PERF_RULES`. Робочий стіл (`Desk.jsx`, `useSessionAnalysis`) рахує їх з `usePerf()` на кожну версію сховища; знахідки лишаються, доки не почався новий збір.
- `app/common/node/perf/android.js` — заміри Android: один `adb shell` на секунду (рядок `/proc/stat` і `/proc/<pid>/stat` усіх процесів застосунку), `dumpsys meminfo <пакет>` раз на 5 с, тип збірки з `dumpsys package`.
- `app/common/node/perf/ios.js` — заміри симулятора: pid з `simctl spawn <udid> launchctl list`, CPU-час із `ps -o time=`, потоки з `ps -M`, пам'ять з `footprint -f bytes --noCategories` раз на 2 с, тип збірки з `codesign -d --entitlements`.
- `app/common/node/perf/session.js` — `PerfSession`: таймери, ряд замірів, позначки процесу, стан; шле пачки в інтерфейс, як `LogSession`.
- `app/electron/main/ipc/perf.js` — `perf:start`, `perf:stop`, `perf:snapshot`; пачки — `perf:batch`. Міст — `backend.perf` у `app/electron/preload/preload.mjs` і `app/electron/renderer/polyfills.js`.
- `app/common/renderer/components/Perf/perf-store.js` — сховище (`useSyncExternalStore`): ряд, позначки процесу, позначки екранів (зі сховища екранів сесії), стан.
- `app/common/renderer/components/Perf/PerfTool.jsx`, `PerfChart.jsx`, `Perf.module.css` — вкладка «Продуктивність»: графіки на SVG без бібліотек.
- `app/common/renderer/lib/session/quick-session.js` — старт сесії для пристрою й застосунку з шапки; ним користуються «Почати сесію» (`QuickStart.jsx`) і вкладка «Продуктивність».
- `app/common/renderer/components/Workstation/Workstation.jsx` — `SessionBootstrap` (keep-alive і час сесії, хоч би де її почали), `PerfFollower` (зупиняє збір, коли в шапці інший пристрій чи застосунок) і `PerfScreenWatch` (стеження за екраном, поки йде збір, а Інспектор закритий).
- `app/common/renderer/components/A11yTool/screen-history.js` — `subscribeScreenHistory()` для позначок екранів; `screen-follower.js` — `whileHidden`.
- `app/common/node/doctor/exec.js` — `run({quiet})`.

Крок 2 — аналізатор і сховище:

- `app/common/shared/perf/baseline.js` — чисто: `PERF_DEFAULTS` і `perfSettings()` (допуски, прогони для еталона, пороги знахідок), `summarizeRun()` / `makeRun()` (зведення прогону), `combineRuns()` (медіана й розкид), `makeBaseline()`, `pickBaseline()` (яким еталоном порівнювати або чому ніяким), `judge()` і `compareBuild()` (гірше / краще / без змін), `baselineFindings()` (`perf-regression`), `trend()`, `runCsv()`.
- `app/common/node/perf/store.js` — `createPerfStore(dir)`: тека `perf/<appId>/` у даних застосунку, `index.json` (зведення прогонів і еталони з історією) і `runs/<id>.json` (графіки й позначки); останні `MAX_RUNS` = 50.
- `app/common/node/perf/session.js` — `run(markers)` (прогін для збереження, версія збірки з `appVersion()` на старті) і `reset()` (новий тест).
- `app/electron/main/ipc/perf.js` — `perf:stop(markers)` і `perf:cut(markers)` зберігають прогін; `perf:history`, `perf:run`, `perf:deleteRun`, `perf:setBaseline`, `perf:export` (CSV чи JSON через діалог збереження).
- `app/common/renderer/components/Perf/perf-history.js` — сховище прогонів застосунку з шапки: `loadPerfHistory`, `selectRun`, `openRun`, `deleteRun`, `makeReference`, `buildReport()`, `lastBuildFindings()`.
- `app/common/renderer/components/Perf/PerfReport.jsx` — «Екрани» (`ScreensView`) і «Збірки» (`BuildsView` з трендом); `PerfTolerances.jsx` — «Допуски»; `perf-format.js` — формат чисел.
- `app/common/renderer/lib/settings/views.js` — `perfConfig` (збережене налаштування профілю) і `usePerfConfig()`; `profiles-store.js` перечитує його, коли змінюється проєкт.
- `app/common/shared/settings/groups.js` — група профілю `perf` (ключ `PERF_CONFIG`).
- `app/common/renderer/components/Desk/Desk.jsx` — аномалії останньої збірки й пороги проєкту в «Виявлених проблемах»; `Workstation.jsx` (`PerfFollower`) читає прогони застосунку з шапки.

## Модель даних

Збір — у пам'яті; прогони й еталони — на диску (крок 2).

- **Sample:** `at` (мс, годинник Mac), `cpu` (% від усіх ядер, сума процесів застосунку), `threads`, `memory` (байти: Android — PSS головного процесу, iOS — footprint), `parts` (Android: `java`, `native`, `graphics`, `code`, `stack`, `other`; байти), `pids`.
- **Marker:** `at`, `kind` (`start`, `end`, `screen`), `pid` чи `key` і `title` екрана.
- **Status:** `state` (`starting`, `live`, `waiting` — застосунок не запущено, `failed`, `stopped`), `reason`, `build` (`debug` / `release` / `unknown`), `flutter` (на iOS — чи є `Flutter.framework`).
- Межа: 2 години замірів раз на секунду (7200); старіші відкидаються.
- **Run** (`index.json`): `id`, `appId`, `platform`, `device` (назва моделі), `os`, `build` (`version`, `number`, `kind`), `startedAt`, `endAt`, `summary.app` (`cpuAvg`, `memoryAvg`, `memoryMax`), `summary.screens[key]` (`title`, `visits`, `seconds`, `cpuAvg`, `memoryStart`, `memoryEnd`, `memoryMax`); лише екрани з назвою.
- **Baseline**: `baselines["<platform>|<device>|<kind>"] = {current, history[]}`; `current` — `build`, `device`, `os`, `runIds`, `at`, `app` і `screens` з `{value (медіана), spread (найгірший прогін мінус медіана), runs}`.
- **Перф-налаштування проєкту** (`PERF_CONFIG`): `tolerances` (`memory` 0.15, `cpu` 0.25, `start` 0.1), `baselineRuns` 3, `rules` (`cpuPercent`, `cpuSeconds`, `memoryGrowthBytes`, `memoryGrowthShare`); порожній об'єкт бере все за замовчуванням.

## API, CLI, MCP

Немає.

## Що зберігає

- `~/Library/Application Support/vision-inspector/perf/<appId>/index.json` і `runs/<id>.json` — прогони й еталони; лише на цьому Mac, з профілем не експортуються.
- `PERF_CONFIG` — у профілі проєкту (група `perf`), переноситься його експортом.

## Рішення

- 2026-10-27. CPU на Android — з `/proc/<pid>/stat` проти першого рядка `/proc/stat` (частка від усіх ядер, як у Android Studio): один виклик `adb shell` на секунду, без `top` чи `dumpsys cpuinfo`, які рахують за власним вікном. Процеси застосунку — з `ps -A` за назвою пакета й `пакет:процес`.
- 2026-10-27. Пам'ять на Android — `dumpsys meminfo` раз на 5 с: він важкий і сам смикає застосунок. Береться головний процес (PSS, «App Summary»), бо так рахує Android Studio.
- 2026-10-27. Симулятор iOS — це процес на Mac: CPU — приріст CPU-часу з `ps` до приросту годинника, поділений на кількість ядер Mac; пам'ять — `footprint`, бо саме footprint вирішує, коли iOS вбиває застосунок.
- 2026-10-27. Debug-збірка: Android — прапорець `DEBUGGABLE` у `dumpsys package`; iOS — `get-task-allow` або `com.apple.security.get-task-allow` в ентайтлментах.
- 2026-10-27. Позначки екранів бере сховище в інтерфейсі зі сховища екранів сесії (зміна `currentKey`), а не головний процес: екрани живуть лише в інтерфейсі.
- 2026-10-27. Сесію Перф починає тим самим кодом, що й «Почати сесію», і лишається на своїй вкладці; стеження за екраном іде в `PerfScreenWatch`, поки Інспектор закритий (у відкритому Інспекторі стежить він сам).
- 2026-10-27. Під час збору стеження йде й у схованому вікні (`useScreenFollower({whileHidden: true})`): QA працює з пристроєм, станція часто за іншими вікнами. Тому `perf:start` вимикає фонове гальмування вікна (`setBackgroundThrottling(false)`), а зупинка вмикає його знову: інакше таймери схованого вікна сповільнюються до раз на хвилину.
- 2026-10-27. `applyLocalServer` задає й `host` сервера: вендор Appium Inspector дописує `host` прямо в стан, і сесія, почата до того, як конструктор сесій завантажив збережений сервер, падала б у dev-режимі на перевірці незмінності Redux.
- 2026-10-27. `run({quiet: true})` не пише в журнал станції успішні виклики, що повторюються щосекунди; невдалі пише.

- 2026-10-28. Збірка — версія й номер, які пристрій каже про застосунок (`appVersion()`, як шапка), читається на старті збору. Еталон і порівняння — лише на тій самій моделі пристрою й того самого типу збірки (debug з debug, release з release); інша версія ОС порівнюється з позначкою.
- 2026-10-28. Еталон — медіана останніх `baselineRuns` прогонів збірки; розкид — наскільки найгірший прогін вищий за медіану. Погіршення — лише понад найбільше з трьох: допуск проєкту, розкид еталона й мінімальна зміна (2 в. п. CPU, 5 МБ пам'яті), щоб 0,1 % → 0,3 % CPU не було «втричі гірше». Різниця CPU показується у відсоткових пунктах.
- 2026-10-28. Збірка порівнюється медіаною своїх прогонів; збірка, що сама є еталоном, не порівнюється. Червоне — пам'ять понад удвічі більший допуск; решта жовте.
- 2026-10-28. Прогін зберігає головний процес: у ньому заміри, а позначки екранів вікно передає з `perf:stop` / `perf:cut`. Прогін коротший за 30 с не зберігається.
- 2026-10-28. Налаштування читаються через `usePerfConfig()`, а не `perfConfig.use()`: React Compiler кешує виклик методу як звичайну функцію й на повторному рендері пропускає хук — «Rendered fewer hooks than expected».
- 2026-10-28. «Виявлені проблеми» на робочому столі показуються й без поточного тесту, коли є знахідки: аномалії останньої збірки лишаються видимими після перезапуску.

## Тести

- `test/unit/perf-rules.spec.js` — критерій 19 (CPU й памʼять)
- `test/unit/perf-baseline.spec.js` — критерії 13–18, 22, 24
- `test/unit/perf-android.spec.js` — критерій 1
- `test/unit/perf-ios.spec.js` — критерій 2
- `test/unit/perf-series.spec.js` — критерії 5, 7
- `test/unit/perf-build-kind.spec.js` — критерій 6
