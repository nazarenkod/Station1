# Профілювання застосунку — задачі

> До [spec.md](spec.md) і [design.md](design.md). Крок 1.

- [x] 1. [P] Розбори виводу Android — `app/common/shared/perf/parsers.js` — тест: `test/unit/perf-android.spec.js` — критерій 1
- [x] 2. [P] Розбори виводу симулятора iOS — `app/common/shared/perf/parsers.js` — тест: `test/unit/perf-ios.spec.js` — критерій 2
- [x] 3. [P] Тип збірки — `app/common/shared/perf/parsers.js` — тест: `test/unit/perf-build-kind.spec.js` — критерій 6
- [x] 4. Ряд, CPU, переходи процесів, відрізки екранів — `app/common/shared/perf/series.js` — тест: `test/unit/perf-series.spec.js` — критерії 5, 7
- [x] 5. Заміри й сесія збору — `app/common/node/perf/{android,ios,session}.js` — критерії 1, 2, 5, 23
- [x] 6. IPC і міст — `app/electron/main/ipc/perf.js`, `main.js`, `preload.mjs`, `polyfills.js`
- [x] 7. Старт сесії з шапки окремо від `QuickStart` — `app/common/renderer/lib/session/quick-session.js`, `QuickStart.jsx` — критерій 7
- [x] 8. Сховище й вкладка — `app/common/renderer/components/Perf/*`, `tools.js`, `index.jsx`, тексти — критерії 1, 2, 5, 6, 7
- [x] 9. Стеження за екраном і keep-alive поза Інспектором — `Workstation.jsx`, `screen-history.js` — критерій 7
- [x] Перевірка: lint, формат, юніт-тести, наживо в `npm run dev:electron` на симуляторі
