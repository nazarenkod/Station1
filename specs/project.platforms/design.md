# Проєкт по платформах — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [2. Робоча станція](../SPEC.md#shell).

## Де в коді й точка розширення

Тип плагіна за документом: модель даних і панель UI.

- `app/common/shared/settings/platforms.js` — чисті функції платформ: `cleanPlatforms` (лише `multi`, або `android` й `ios` у цьому порядку, ніколи порожньо), `migrateProfile` (старий профіль → платформи), `platformKey` (розділ для платформи пристрою), `projectAppsOf` / `appOfProject`, `setPlatforms`, `makeMulti`, `splitMulti`, `projectAdvice` (порада: `noPlatform` чи `noApp`), `rulePlatform` (платформа правила збірки), `platformOfDevice`.
- `app/common/shared/settings/source.js` — код профілю по платформах: `projectSource(source, platforms)`, `sourceFor`, `sourceOfRepo`, `setBranches`, `changeRepo`, `newRepo(folder, platform)`, `agentWorkspace` (код однієї платформи; вибору платформи сабмодуля більше немає).
- `app/common/shared/settings/profiles.js` — `ensureProfiles` переводить старі профілі й каже `migrated`; `addProfile({platforms})`; `setProfilePlatforms(profiles, id, change)` (`[…]`, `'multi'`, `'split'`).
- `app/common/node/settings/station-settings.js` — зберігає переведені профілі, віддає `platforms` в описі профілю, `setProfilePlatforms` (теки прибраних репозиторіїв забуваються, як і в `setProfileSource`).
- `app/common/shared/settings/transfer.js` — експорт з `platforms`; імпорт старого файлу через `migrateProfile`.
- IPC: `settings:setProfilePlatforms`; міст — `backend.settings.setProfilePlatforms`; `addProfile(name, {copy, platforms})`.
- Головний процес: `ipc/source.js` звіряє кожен репозиторій із гілками його платформи (`sourceOfRepo`); `ipc/task.js` бере коміти з репозиторію платформи; `ipc/agent.js` відкриває агенту `sourceFor(source, platformKey(profile, платформа пристрою))`.
- Інтерфейс:
  - `components/Settings/ProjectPlatforms.jsx` — вкладки платформ («＋ Android/iOS», «⋯»: мультиплатформа, розділити, прибрати), у вкладці «Застосунок», «Код і гілки» (`BranchFields`, `RepoList` з `SourceSettings.jsx`), «Збірки з GitLab» (`BuildSourcesSettings.jsx` — правила платформи); нижче «Спільний код». Фокус із поради (`state.focus: {field, platform, project}`) обирає вкладку й підсвічує частину.
  - `components/Settings/SettingsPage.jsx` — розділу «Збірки» немає; старий перехід `section: 'builds'` веде в «Профілі» з `field: 'builds'`.
  - `lib/settings/project-advice.js` — `useProjectAdvice`, `adviceText`, `adviceFocus`; `components/Workstation/ProjectAdvice.jsx` — `AdviceActions` (додати платформу, перейти на профіль, вказати застосунок).
  - Порада в «Почати сесію» (`start-problems.js`: `noPlatform`, `noAppFor`), «Даних», «Продуктивності», підказці «Логів», меню проєкту (`ProfilePicker.jsx` зі значками платформ); `DevicePicker.jsx` — запущені пристрої чужих платформ окремо.
  - `actions/Workstation.js` — `appForProject({…, platforms})` не дає застосунку пристрою платформи, якої в проєкті немає; `Workstation.jsx` подає `projectAppsOf(profile)` і платформи.

## Модель даних

```
Profile {id, name, platforms: ['android'] | ['ios'] | ['android', 'ios'] | ['multi'],
         apps: [{id, platform: 'android' | 'ios'}],            // у multi — обидва
         source: {branches: {[platform]: {dev, release}},
                  repos: [{id, name, platform: 'android' | 'ios' | 'multi' | 'shared', guessed?}]},
         groups, updatedAt}
BuildRule {id, project, platform?, virtual: {jobs, file}, real: {jobs, file}}   // у BUILD_JOBS.rules
```

Профіль без `platforms` — старий: його переводить `migrateProfile` під час читання (і в імпорті).

## API, CLI, MCP

Немає нових. Агент бачить код платформи пристрою через ті самі теки розмови.

## Що зберігає

- `PROFILES`: профілі з `platforms` і новим `source`; перекладені профілі записуються одразу після читання.
- `SOURCE_PATHS` без змін: теки прив'язані до id репозиторіїв, а id під час переходу не змінюються.
- `BUILD_JOBS.rules[].platform` — після першого збереження правила в розділі платформи.

## Рішення

- **2026-10-28. Один список репозиторіїв з полем `platform`, а не окремі списки в розділах.** Так теки на Mac, кнопки git, задачі й інструменти агента далі знаходять репозиторій за id. Розділ — це фільтр (`sourceFor`).
- **2026-10-28. Мультиплатформа — окрема платформа `multi`, не той самий репозиторій у двох розділах.** Рішення користувача: Flutter чи KMP — один проєкт і одна платформа, з двома застосунками.
- **2026-10-28. Платформа сабмодуля прибрана.** У розділі платформи всі його сабмодулі — її. Вибір платформи сабмодуля потрібен був лише тоді, коли Android та iOS лежали в одному списку.
- **2026-10-28. Правила збірок лишаються в `BUILD_JOBS` профілю.** Пошук правила за шляхом GitLab не змінюється. Розділ показує правила своєї платформи (`rulePlatform`), а старе правило без платформи потрапляє в розділ за шляхом.
- **2026-10-28. Пристрій чужої платформи не отримує застосунку.** Навіть встановлений застосунок із минулого запуску. Інакше «Дані» й «Продуктивність» показували б дані застосунку, якого в проєкті немає.

## Тести

| Файл | Критерії |
|---|---|
| `test/unit/project-platforms.spec.js` | 1–6, 8, 9 |
| `test/unit/project-source.spec.js` | 2, 3 (код платформи, теки агента) |
| `test/unit/workstation-app.spec.js` | 4, 5 |
| `test/unit/start-problems.spec.js` | 6 |
| `test/unit/settings-backup.spec.js` | 10 |
| `test/unit/settings-profiles.spec.js` | 11 |

Наживо (2026-10-28, симулятор iPhone 15, власна копія станції): перехід старого профілю (репозиторій «Застосунок» без застосунків → Android з «Перевірте»), вкладки платформ, «Збірки з GitLab», «Спільний код», порада в меню проєкту й «Даних», «Додати iOS у проєкт» з переходом до поля, «Зробити мультиплатформним».
