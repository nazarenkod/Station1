# Інспектор: швидке стеження, шлях сесії, стани екранів — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [6. Інспектор і автоматизація](../SPEC.md#inspector).

## Де в коді й точка розширення

Джерело даних (екрани) і панель UI, поверх [inspector.screen](../inspector.screen/design.md).

- `app/common/renderer/lib/a11y/screen.ts` — `screenState(tree)`: відбиток стану (id елементів без текстів, без клавіатури й статус-бару) і назва стану з діалогу чи сповіщення.
- `app/common/renderer/components/A11yTool/screen-flow.js` — чисті функції: `followDelay()` (темп стеження), `addScreen()` (екрани, стани, межі), `addStep()` (шлях зі стисканням повторів), `actionKind()` (команда Інспектора → тап, жест, текст, «назад», команда; `executeScript` з `mobile: tap` чи `mobile: swipe` — за назвою скрипту).
- `app/common/renderer/components/A11yTool/screen-history.js` — сховище сесії (`useSyncExternalStore`): мініатюри й зменшені скриншоти на canvas, `noteAction()` для дій Інспектора, `clearScreenHistory()`.
- `app/common/renderer/components/A11yTool/screen-follower.js` — стеження з темпом `followDelay()` замість сталих 2 с.
- `app/common/renderer/actions/A11y.js` — `runA11yScan()` кладе `state` у `a11yScreen`; `showStoredA11yScreen()` показує збережений стан.
- `app/common/renderer/actions/SessionInspector.js` — `applyClientMethod()` повідомляє `noteAction()` про кожну команду, крім читання екрана.
- `app/common/renderer/components/A11yTool/ScreenStrip.jsx` — стани екрана й рядок шляху.
- `app/common/renderer/components/Desk/NewTestDialog.jsx` — «Новий тест» очищає й екрани сесії разом з аудитом.

## Модель даних

Лише в пам'яті, до кінця сесії.

- **Screen:** `key`, `title`, `source`, `named` (є назва), `firstAt`, `lastAt`, `visits`, `states[]`, `currentStateId`.
- **State:** `id` (хеш відбитка), `title` (з діалогу або «стан N»), `firstAt`, `lastAt`, `visits`, `thumb` (JPEG 96 px), `screenshot` (повний — лише в останнього баченого стану екрана), `reduced` (JPEG 720 px), `sourceXML`, `score`, `counts`.
- **Step:** `key`, `stateId`, `at`, `action` (дія Інспектора або null), `repeat` (скільки разів поспіль ходили туди й назад).
- Межі: 40 екранів, 10 безіменних, 5 станів на екран (перший не витісняється), 200 кроків (`pathDropped` — скільки згорнуто).

## API, CLI, MCP

Немає.

## Що зберігає

Нічого на диску.

## Рішення

- 2026-10-27. Ключ екрана — назва з `identifyScreen()`; стан — набір id видимих елементів без текстів. Id, що збігається з текстом чи підписом (iOS `name` без accessibilityIdentifier), не рахується: він змінюється разом із сумою чи датою. Без жодного id стан — набір типів елементів.
- 2026-10-27. Рядки прокручуваних списків (таблиця й колекція iOS, `RecyclerView`, `ListView`, `ScrollView` та інші) рахуються, хоч би чи вони на екрані: у «Налаштуваннях» iOS кожен рядок має свій id, і прокрутка інакше давала новий стан. Поза списками — лише видимі елементи, щоб банер чи діалог, що з'явився, був новим станом.
- 2026-10-27. Темп — `setTimeout` з `followDelay()`: 0,5 с упродовж 4 с після дії Інспектора, інакше 1,5 с. Заспокоєний екран — два однакові знімки поспіль, як і раніше.
- 2026-10-27. Дія біля кроку — остання команда Інспектора після попереднього кроку, не давніша за 5 с: екран заспокоюється вже після дії, тож 3 с від самої дії мало.

## Тести

- `test/unit/screen-flow.spec.js`
- `test/unit/a11y-screens.spec.js`
