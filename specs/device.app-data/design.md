# Дані застосунку на пристрої — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [3. Пристрій і сесія](../SPEC.md#device).

## Де в коді й точка розширення

Тип плагіна за документом: джерело даних і панель UI.

Чисті функції (і Node, і інтерфейс) — `app/common/shared/app-data/`:

| Файл | Що робить |
|---|---|
| `prefs-android.js` | SharedPreferences XML: розбір у типізовані записи й запис назад |
| `datastore.js` | Jetpack DataStore Preferences (`*.preferences_pb`): протобуф `PreferenceMap` — розбір і запис |
| `plist.js` | XML plist із типами (`date`, `data`, `integer`, `real` не губляться): розбір і запис |
| `classify.js` | вид файлу за шляхом і першими байтами: налаштування, SQLite, текст, JSON, XML, plist, картинка, двійковий; зашифровані налаштування; службові файли SQLite (`-wal`, `-shm`, `-journal`) |
| `values.js` | впізнавання значень: JWT (з `exp`), JSON, час Unix, base64, URL |
| `diff.js` | різниця двох читань: налаштування за ключем, рядки таблиць за `rowid`/ключем, файли за розміром і часом |
| `search.js` | пошук по налаштуваннях, рядках таблиць, назвах і тексту файлів |
| `access.js` | причина, чому доступу немає, з виводу `run-as`, `su`, `simctl`, `devicectl` |
| `agent.js` | відповіді інструментів агента: зведення, приховування токенів і секретів |

Лише Node — `app/common/node/app-data/`:

| Файл | Що робить |
|---|---|
| `transport.js` | доступ до пісочниці одним інтерфейсом: `list`, `read`, `write`, `remove`, `stop`, `launch`, `clear`, `readPrefs`/`writePrefs` для iOS |
| `android.js` | `adb exec-out run-as <pkg> …` або `adb exec-out su 0 …`; запис через `adb exec-in … sh -c 'cat > …'`; зупинка `am force-stop`, запуск `monkey -p … 1`, скидання `pm clear` |
| `simulator.js` | контейнер `simctl get_app_container <udid> <app> data` і `groups` — звичайна файлова система Mac; налаштування через `simctl spawn <udid> defaults export/import <шлях>`, щоб cfprefsd симулятора не перезаписав їх зі свого кешу; `simctl terminate/launch` |
| `iphone.js` | `devicectl device info files`, `copy from`, `copy to` з `--domain-type appDataContainer`; зупинка й запуск — `devicectl device process` |
| `plist-files.js` | двійковий plist ↔ XML через `plutil` |
| `sqlite.js` | `node:sqlite` (Electron 44, Node 24) над локальною копією бази: таблиці, схема, сторінка рядків, SQL, пошук, підготовка до запису назад |
| `service.js` | один об'єкт на пару пристрій + застосунок: дзеркало пісочниці, читання, стеження, стрічка змін, запис із копією «до», відкат |

Головний процес: `app/electron/main/ipc/app-data.js` — канали `appData:*`, подія `appData:update`. Міст — `appData` у `app/electron/preload/preload.mjs`, `backend.appData` у `app/electron/renderer/polyfills.js`.

Інтерфейс — `app/common/renderer/components/AppData/`: `AppDataTool.jsx` (маршрут `/data`), `app-data-store.js` (зовнішнє сховище з `useSyncExternalStore`), `PrefsView.jsx` і `PrefEditor.jsx`, `DbView.jsx`, `FilesView.jsx`, `ValueView.jsx` (позначки й бічна панель значення), `ChangesPanel.jsx` («Що змінилося» й «Мої зміни»), `PinsBar.jsx`, `SearchResults.jsx`, `format.js`, `AppData.module.css`. Інструмент на панелі — `app/common/renderer/components/Workstation/tools.js` (`data`, колір `--vi-tool-data` у `main.css`). `AppDataFollower` у `Workstation.jsx` каже головному процесу, які пристрій і застосунок обрано в шапці, а `app-data-store.js` — на якому екрані сесія.

Довкола: `run()` у `app/common/node/doctor/exec.js` уміє `input` (stdin), `maxOutput` і віддає сирі байти в неперелічуваному `stdoutBuffer`; канал `appData:screen` тихий у журналі (`app/common/node/journal.js`); `vite.config.mjs` дає тестам `--experimental-sqlite` для Node 22.5–23.

Агент: `app/common/node/agent/app-data-tools.js` — `app_data_stats`, `app_data_search`, `app_data_get`, `app_data_changes`; підключено в `app/electron/main/ipc/agent.js`.

## Модель даних

Головний процес тримає `AppDataService` на обрану пару пристрій + застосунок (`appData:select` з інтерфейсу, як логи стежать за шапкою). Інтерфейс отримує готовий знімок, а не файли.

```
Snapshot {
  target: {deviceId, appId, platform, access: 'run-as' | 'root' | 'simulator' | 'devicectl'},
  readAt, error: {reason, hint, detail} | null,
  prefs: [{file, format: 'shared-prefs' | 'datastore' | 'plist', encrypted, entries: [{key, type, value}]}],
  dbs:   [{file, size, tables: [{name, rows, columns: [{name, type, pk}]}]}],
  files: [{path, size, mtime, kind}],        // уся пісочниця; групи iOS — тека `@group.<id>/`
  totals: {prefs, dbs, files, bytes},
}
Change {id, at, screen, section, file, kind: 'added' | 'changed' | 'removed', key, table, before, after}
Edit   {id, at, file, summary, backup}       // «Мої зміни»
```

- Тип значення налаштувань: `string`, `int`, `long`, `float`, `double`, `boolean`, `set`, `date`, `data`, `array`, `dict`. Числа `long` зберігаються рядком, щоб не губити точність.
- Дзеркало: файл тягнеться з пристрою, лише коли змінився його розмір чи час зміни. Налаштування й бази тягнуться завжди, решта файлів — коли їх відкривають чи шукають у них (текстові файли до 256 КБ, до 20 МБ на один пошук).
- База читається з копії: основний файл, `-wal` і `-shm` разом, потім `wal_checkpoint(TRUNCATE)` і `journal_mode=DELETE` на копії. Запис: SQL виконується над копією, основний файл іде назад, а `-wal`/`-shm` на пристрої видаляються (на iPhone, де видаляти нічим, `-wal` замінюється порожнім), інакше старий журнал ліг би поверх нової бази.
- Різниця рядків таблиці рахується для таблиць до 5 000 рядків; більші порівнюються лише кількістю.
- Поточний екран для стрічки змін надсилає інтерфейс (`appData:screen`), коли змінюється екран сесії ([inspector.flow](../inspector.flow/spec.md)).

## API, CLI, MCP

IPC (`appData:*`): `select(device, appId)`, `refresh()`, `watch(on)`, `screen(title)`, `table(file, table, {offset, sort, filter})`, `query(file, sql, {confirmed})`, `file(path)` (вміст для перегляду), `save(path)` (на Mac через діалог), `setPref(file, key, value, type)`, `removePref(file, key)`, `put(path, localFile)`, `removeFile(path)`, `revert(editId | 'all')`, `clear()`, `clearBackups()`, `search(text)`. Подія `appData:update` несе знімок, стрічку змін і «Мої зміни».

MCP: чотири інструменти читання з [spec.md](spec.md), критерії 21–22.

## Що зберігає

- `APP_DATA_PINS` у `app/common/shared/setting-defs.js`: `{[appId]: [{file, key}]}` (файл без `key` — закріплений файл), група профілю `appData` (`app/common/shared/settings/groups.js`, `cleanPins`), тож іде з профілем і експортом. В інтерфейсі — збережений вигляд `appDataPins` (`app/common/renderer/lib/settings/views.js`), який профіль перечитує й записує, як фільтри проксі й логів.
- Тека `<дані станції>/app-data/<пристрій>/<застосунок>/`: `mirror/` (дзеркало пісочниці), `backups/` (копії «до»). «Очистити копії» видаляє обидві.
- Стрічка змін і «Мої зміни» — лише в пам'яті головного процесу, до перезапуску станції.

## Рішення

- **2026-10-27. Root на емуляторі через `su 0`, а не `adb root`.** `adb root` перезапускає adbd, а з ним обриваються сесія Appium, лог і проксі. Образи google_apis мають `su`; якщо adbd уже root, станція бере це.
- **2026-10-27. Налаштування симулятора — через `defaults` за шляхом до plist, а не прямий запис файлу.** cfprefsd симулятора тримає налаштування в кеші й перезаписує файл своїм станом; `defaults export/import <шлях без .plist>` іде через нього. Перевірено на iOS 17 симулятора.
- **2026-10-27. SQLite — `node:sqlite`, а не `sqlite3` CLI чи нативний модуль.** Він уже є в Node 24 Electron 44, без збирання й без розбору тексту.
- **2026-10-27. Групи застосунків на iPhone не показуються.** `devicectl` вміє `appGroupDataContainer`, але не каже, які групи має застосунок; на симуляторі їх дає `get_app_container … groups`.
- **2026-10-27. Скидання даних без копії «до».** Копія всієї пісочниці — це вже «Знімок стану», окрема фіча.
- **2026-10-27. Цілі з бази читаються як BigInt.** Інакше одне число понад 2^53 (кеш URLSession) зупиняє читання всієї таблиці. Точні числа віддаються числами, решта — текстом.
- **2026-10-27. Час файлів на Android — `stat %y` з дробом секунди.** `%Y` дає цілі секунди, і запис того самого розміру в ту саму секунду лишився б непоміченим.

## Тести

| Файл | Критерії |
|---|---|
| `test/unit/app-data-access.spec.js` | 1, 2 (і розбір виводу adb, simctl, devicectl) |
| `test/unit/app-data.spec.js` | 3, 4, 5, 9, 19 |
| `test/unit/app-data-values.spec.js` | 6 |
| `test/unit/app-data-sqlite.spec.js` | 7, 8 |
| `test/unit/app-data-search.spec.js` | 4, 10 |
| `test/unit/app-data-diff.spec.js` | 11, 12 |
| `test/unit/app-data-write.spec.js` | 3, 8, 9, 10, 12, 13, 15–18, 20 (сервіс на фейковому транспорті) |
| `test/unit/settings-backup.spec.js` | 19 |
| `test/unit/station-mcp.spec.js` | 21, 22 |

Наживо (2026-10-27): симулятор iPhone 15, iOS 17 — читання, стеження, запис ключа, SQL-зміна, відкат, пошук, закріплення, перегляд файлів. Android і iPhone наживо не перевірено.
