# Залежності репозиторію — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [15. Агент станції](../SPEC.md#agent).

## Де в коді й точка розширення

- `app/common/shared/settings/dependencies.js` — чисті функції, спільні для сторінки й агента:
  - розбір файлів: `parsePackageResolved` (v1–v3), `parsePbxPackages` (`XCRemote/LocalSwiftPackageReference`), `parsePackageSwift`, `parsePodfileLock` (`PODS`, `SPEC REPOS`, `EXTERNAL SOURCES`, `CHECKOUT OPTIONS`), `parseGradleSettings` (`includeBuild`, `projectDir`);
  - адреси: `hostOf`, `sameUrl` (та сама адреса, хоч би як записана), `joinPath`;
  - `mergeDependencies` — кожна залежність раз (за видом і адресою), `submoduleDependency`, `dependencyKey` (сабмодуль — за шляхом, як і раніше; решта — `<вид>:<назва>`);
  - `isOwnDependency` — своя: локальна, відносна адреса, хост `origin` (без `origin` — усі свої); `dependencyCode` — `own` / `found` / `none` і тека; `describeDependencies` — для сторінки, свої першими за видом, сабмодулі деревом (`moduleTree` з `source.js`);
  - `agentWorkspace` (перенесено з `source.js`) — теки репозиторіїв і своїх залежностей з кодом, без сторонніх, спільне — раз; повертає й `map`; `codeMap` — рядки мапи.
- `app/common/node/source/repo.js` — `listDependencies(root, modules)`: файли — `git ls-files --cached --others --exclude-standard` за шаблонами (`DEPENDENCY_FILES`), без `Pods`, `node_modules`, `.build`, `Carthage`, `build`, `DerivedData`, не глибше 6 рівнів; `Package.resolved` поруч із кожним `.xcodeproj` читається з диска, навіть якщо git його ігнорує. Локальні пакети, поди з `:path` і модулі Gradle — шлях від теки свого файлу, `present` — чи тека є; под зі spec-репозиторію чи git — код у `Pods/<назва>`; модуль Gradle всередині репозиторію — не залежність. `inspectRepo` віддає `dependencies`; `submodules` лишаються для скидання змін.
- `app/common/node/agent/service.js` — `sessionInputs` бере `workspace` до запису інструкцій і передає `codeMap(code.map)` у `composeSteering` (`app/common/shared/agent/instructions.js`, розділ «Where the app’s code is» після проєкту).
- `app/electron/main/ipc/agent.js` — `workspace` кличе `agentWorkspace` з `dependencies.js`.
- Інтерфейс: `app/common/renderer/components/Settings/DependencyList.jsx` — «Залежності · N» і «без коду: M», групи за видом (`KIND_ICONS`), «Сторонні · N» згорнуто; рядок `DependencyRow`: крапка стану, назва, версія, хост стороннього; тека — `backend.source.setModulePath(profileId, repoId, key, folder)`. Стилі — `dep*` у `SettingsPage.module.css`.

## Модель даних

```
Dependency {kind: 'submodule' | 'spm' | 'pod' | 'gradle', key, name, url?, specRepo?, version?,
            path?          // сабмодуль: шлях у репозиторії
            initialized?   // сабмодуль: завантажено
            local, present, folder?}   // решта: де код за проєктом
```

## API, CLI, MCP

Нових немає. IPC `source:setModulePath` тепер бере ключ будь-якої залежності.

## Що зберігає

`SOURCE_PATHS[profile][repo].modules` — свої теки залежностей за ключем: сабмодуль за шляхом (старі записи працюють як були), решта — `spm:pbcore`, `pod:p24core`, `gradle:kit`. В експорт не йде.

## Рішення

- **2026-10-28. Сторонні — ніколи агенту.** Рішення користувача: теки самі контексту не коштують, але пошук по Firebase чи Alamofire забиває результати. Своя/стороння — за хостом `origin`: просто й без налаштувань.
- **2026-10-28. Мапа коду в інструкціях.** Кілька рядків замість пошуку по всіх теках: агент іде просто в модуль.
- **2026-10-28. Кеш Xcode не джерело коду.** `DerivedData/…/SourcePackages` тимчасовий і в кожного свій; для свого пакета людина вказує клон.
- **2026-10-28. Файли — з `git ls-files`.** Швидко, без обходу `Pods` і збірок, і бачить лише файли проєкту, а не сабмодулів.

## Тести

| Файл | Критерії |
|---|---|
| `test/unit/project-dependencies.spec.js` | 1, 2, 3, 5, 6 (розбір файлів, репозиторій на диску, своя/стороння, теки агента, мапа) |
| `test/unit/agent-profile.spec.js` | 6 (мапа в інструкціях) |
| `test/unit/project-source.spec.js` | теки агента зі сабмодулями, як раніше |

Наживо (2026-10-28, Linux у хмарі під Xvfb, власна копія станції): Android-репозиторій із сабмодулями (вкладений, не завантажений — «Вказати теку»), iOS-репозиторій з Xcode-проєктом, двома локальними пакетами, `Package.resolved`, `Podfile.lock` (git, приватний spec-репозиторій, trunk) — групи, версії, своя тека для `pbcore`, «Сторонні · 3». Не перевірено: справжній Xcode-проєкт на Mac, мапа коду в живій розмові Kiro.
