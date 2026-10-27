# Задача: контекст і імпакт-аналіз — як зроблено

> Дизайн до контракту [spec.md](spec.md). Частина [основної специфікації](../SPEC.md), розділ [15. Агент станції](../SPEC.md#agent).

## Де в коді й точка розширення

- `app/common/shared/task/task-text.js` — ключ задачі з ключа чи посилання (`/browse/KEY`, `selectedIssue=KEY`); посилання на MR GitLab і сторінки Confluence в текстах (свій сайт чи інший); сторінка Confluence (storage) як текст; рядки diff.
- `app/common/node/task/context.js` — `collectTaskContext({key, jira, gitlab, git})`:
  - задача через Jira API v2 (опис і коментарі вже текстом);
  - remote links;
  - підзадачі, батько й звʼязки будь-якого типу, до 12, кожна повністю;
  - сторінки Confluence тим самим токеном (`/wiki/rest/api/content/<id>?expand=body.storage`), до 20 000 символів;
  - MR з посилань: `merge_requests/:iid` і `diffs` (старі GitLab — `changes`);
  - коміти з ключем у гілці розробки (`git log origin/<dev> --grep`).

  Джерело, що впало, лишає запис у `problems`.
- `app/common/node/task/store.js` — задачі профілю: поточна й останні (`TASKS`), файл задачі `<userData>/tasks/<profile>/<KEY>.json` з `context`, `impact`, `checks`, `feedback`. `saveImpact` перевіряє чек-лист, рахує, що додалося й зникло, і лишає позначки на пунктах, що лишилися. `creditImpact` дописує кредити ходу, у якому зроблено аналіз.
- `app/common/shared/task/impact.js` — `validateImpact`: є доказ, немає повторів, немає загальних порад; ліміту на кількість немає. Також `itemId` (той самий текст — той самий id), `impactChanges`, `impactStale` (змінився `sha` MR, зʼявився новий MR чи оновилася задача).
- `app/common/shared/task/for-agent.js` — контекст для агента частинами: `outline` (за замовчуванням), `task`, `linked`, `pages`, `mrs`, `commits`, `impact`.
- `app/common/node/agent/task-tools.js` — інструменти агента `task_context` (читає) і `impact_report` (зберігає чек-лист; `autoAllow`, бо не змінює роботу станції).
- `app/electron/main/ipc/task.js` — IPC `task:*`, доступ до Jira (`JiraClient.get`, `site`), GitLab (`GitLabService`) і головного репозиторію профілю; подія `task:changed`.
- Вікно: `renderer/lib/task/task-store.js`; `components/Desk/TaskPanel.jsx` (поле, карта, деталі, чек-лист); чип задачі в шапці (`WorkstationHeader.jsx`, ховається у вузькому вікні); чип `task` у довідці агента; розмова агента йде за задачею (`AgentFollower`, `openConversation({taskKey})`).

## Модель даних

- `TASKS` (лише цей Mac): `{[profileId]: {current, recent: [KEY]}}`, до 10 останніх.
- Файл задачі: `{key, context, impact, checks: {[itemId]: true}, feedback: {[itemId]: {kind: 'useful' | 'noise', reason, at}}}`.
- `context`: `{key, url, fetchedAt, task, linked, pages, mrs, commits, otherLinks, problems}`.
- `impact`: `{at, items: [{id, section: 'check' | 'regress', text, important, why, evidence: [{file, lines, commit, mr, note}]}], empty, changes, mrVersions: [{url, sha}], conversation, turn, credits, stale}`.

## Рішення

- **Jira API v2, а не v3** (2026-10-27): опис і коментарі — текст, а не ADF, тож їх не треба розбирати.
- **MR — з посилань у коментарях**, як домовилися з користувачем; пошуку MR за ключем немає.
- **Імпакт-аналіз — хід агента з глибоким бюджетом**, а результат іде інструментом `impact_report`, не текстом чату. Станція перевіряє правила сама, тож якість не залежить від того, як модель відформатує відповідь. Відкинуті пункти повертаються агенту з причиною, щоб він їх виправив.
- **«Шум» поки зберігається біля пункту**; поправкою памʼяті він стане разом з [agent.memory](../agent.memory/spec.md). «Зробити ціллю» — разом з [agent.goals](../agent.goals/spec.md).

## Тести

`test/unit/task-context.spec.js`: ключ, посилання, сторінка, diff, збір контексту з підробленими Jira й GitLab, правила чек-листа, застарілість, сховище, інструменти агента.
