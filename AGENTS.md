# Station#1 — інструкції для агентів

Station#1 (робоча назва) — робоча станція QA-інженера для Android та iOS на основі форку Appium Inspector: інспектор і доступність, проксі, логи, збірки, робочий стіл. Інтерфейс український.

## Перед будь-якою зміною

1. Знайди частину продукту в **[specs/SPEC.md](specs/SPEC.md)** (розділи 2–11) і відкрий її фічу: `specs/<id>/spec.md` — що має бути, `specs/<id>/design.md` — де це в коді.
2. **Зміна поведінки починається зі спеки**: спершу `spec.md` (критерії Given / When / Then), потім код. Нова фіча чи новий обсяг — чернетку спеки погоджує користувач. Процес — [SPEC.md → розділ 14](specs/SPEC.md#process); у Claude Code є skill `spec-feature`.
3. Принципи продукту (local-first, секрети, відкат змін, лише localhost) — [SPEC.md → розділ 13](specs/SPEC.md#rules). Вони обов'язкові для кожної зміни.

## Команди

| Що | Команда |
|---|---|
| Залежності | `npm ci` |
| Застосунок у режимі розробки | `npm run dev:electron` |
| Юніт-тести | `npx vitest run test/unit` (одна: `npx vitest run test/unit/<файл>`) |
| Lint | `npx oxlint -c oxlint.config.mjs .` |
| Формат | `npx oxfmt -c oxfmt.config.mjs .` (перевірка: `--check`) |
| Поставити на цей Mac | `npm run install:mac` |
| DMG для інших Mac | `npm run pack:mac` (підпис — `docs/signing.md`) |
| Значки з SVG | `npm run icons` |
| CLI і MCP | `npm run build:cli`, потім `node dist-cli/vision-inspector.mjs doctor \| audit \| build <файл> \| mcp` |

## Карта коду

| Тека | Що там |
|---|---|
| `app/electron/main/` | головний процес; `ipc/<область>.js` — обробники IPC |
| `app/electron/preload/preload.mjs` | міст `window.electronIPC.*` |
| `app/electron/renderer/polyfills.js` | `backend.*` для інтерфейсу (у вебзбірці `null`) |
| `app/common/renderer/` | інтерфейс React: `components/<Інструмент>/`, `actions/`, `reducers/`, `lib/a11y/` |
| `app/common/node/` | лише Node: `doctor/`, `device/`, `builds/`, `logs/`, `proxy/`, `gitlab/`, `jira/`, `ai/` |
| `app/common/shared/` | і Node, і інтерфейс: `findings/`, `builds/`, `ios/`, `proxy/`, `setting-defs.js`, `product.js` |
| `app/common/public/locales/{uk,en}/translation.json` | тексти інтерфейсу |
| `app/cli/` | CLI і MCP-сервер |
| `test/unit/` | юніт-тести (vitest) |
| `specs/` | специфікації продукту |
| `docs/` | документація upstream Appium Inspector; наше — лише `docs/signing.md` |

## Як писати код тут

- **IPC — три місця разом:** `ipcMain.handle('<область>:<дія>')` в `app/electron/main/ipc/`, метод у `preload.mjs`, виклик через `backend.<область>` в інтерфейсі.
- **Логіка без UI** — в `app/common/shared/` (чисті функції) або `app/common/node/`; її покривають юніт-тести. Інтерфейс лише викликає її.
- **Стан:** Redux для стану станції; для великих і частих потоків (логи, проксі, пайплайни, екрани сесії) — зовнішнє сховище з `useSyncExternalStore`.
- **Налаштування:** ключ і значення за замовчуванням у `app/common/shared/setting-defs.js`. **Секрети** — лише через `encryptedSecret` (`app/electron/main/secrets.js`).
- **Тексти:** кожен новий ключ — і в `uk`, і в `en`. Російської немає, її прибрано свідомо. Назва продукту — з `app/common/shared/product.js`, не текстом.
- **Інтерфейс:** antd 6, CSS-модулі, токени `--vi-*` і `--ant-*`; без інлайн-кольорів.
- **Коментарі** пояснюють навіщо, простими реченнями, як у сусідньому коді.
- **Тести інтерфейсних модулів** мокають `polyfills.js` (приклад — `test/unit/pipeline-watch.spec.js`).

## Готово, коли

- `npx oxlint -c oxlint.config.mjs .` без помилок, `npx oxfmt -c oxfmt.config.mjs --check .` чисто;
- `npx vitest run test/unit` зелений (два e2e-набори без живого Appium падають і без змін — це нормально);
- поведінку перевірено в `npm run dev:electron` на симуляторі чи емуляторі, де це можливо; що не перевірено — сказати прямо;
- `spec.md` і `design.md` фічі оновлені в тому самому коміті.

## Git

- Основна гілка `main`. Поки йде активна розробка, комітимо й заливаємо прямо в неї: `git -c http.postBuffer=524288000 push origin main`. `origin` — наш репозиторій `github.com/nazarenkod/Station1`; в upstream Appium Inspector не заливаємо нічого.
- Комітити лише свої зміни: у цій теці можуть одночасно працювати інші сесії. Перед комітом дивитися `git status` і додавати файли поіменно.
- Повідомлення коміту англійською, у стилі історії (`feat(область): …`, `fix(область): …`).

## Підводні камені

- Зміна коду головного процесу перезапускає `dev:electron`, і Appium разом із сесіями обривається.
- Appium 3 потребує Node `^20.19 || ^22.12 || >=24`: станція запускає його вбудованим Node з Electron (`ELECTRON_RUN_AS_NODE=1`), а не системним.
- Брандмауер macOS питає про WebDriverAgent після кожного його перезбирання; Appium з `127.0.0.1` не питає.
- Ключі в Keychain прив'язані до назви застосунку: у dev-збірці й у встановленій вони різні.
- Дані застосунку — `~/Library/Application Support/vision-inspector`, незалежно від назви продукту.
