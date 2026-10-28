# Профілювання застосунку — задачі

> До [spec.md](spec.md) і [design.md](design.md). Кроки 1 і 2 зроблено; файл лишається, поки фіча не `implemented`.

Крок 2 — еталони й аномалії:

- [x] 1. Зведення прогону, еталон, порівняння, знахідки, тренд, CSV — `app/common/shared/perf/baseline.js` — тест: `test/unit/perf-baseline.spec.js` — критерії 13–18, 22
- [x] 2. Сховище прогонів і еталонів — `app/common/node/perf/store.js` — тест: `test/unit/perf-baseline.spec.js` — критерії 13, 14
- [x] 3. Версія збірки, збереження на зупинці й новому тесті, експорт — `app/common/node/perf/session.js`, `app/electron/main/ipc/perf.js`, `preload.mjs` — критерії 13, 22
- [x] 4. Допуски в профілі проєкту — `setting-defs.js`, `settings/groups.js`, `views.js`, `profiles-store.js`, `PerfTolerances.jsx` — тест: `test/unit/perf-baseline.spec.js` — критерій 24
- [x] 5. «Екрани», «Збірки», тренд — `perf-history.js`, `PerfReport.jsx`, `PerfTool.jsx` — критерії 15, 17, 18
- [x] 6. Аномалії на робочому столі, пороги з проєкту — `Desk.jsx`, `Workstation.jsx` — критерії 16, 19
- [x] Перевірка: lint, формат, юніт-тести, наживо на симуляторі iOS

Далі: старт і кадри Android, батарея, iPhone, трейси й Flutter.
