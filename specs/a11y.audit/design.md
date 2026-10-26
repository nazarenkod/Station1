# Аудит доступності, рішення команди, баги в Jira — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [8. Доступність](../SPEC.md#a11y); стосується також: [10. Bug Capsule і репортинг](../SPEC.md#reporting).

## Де в коді й точка розширення

Аналізатор та інтеграція (Jira). Код: `app/common/renderer/lib/a11y/`, `app/common/renderer/components/SessionInspector/A11yTab/`, `app/common/renderer/actions/A11y.js`, `app/common/node/jira/`.

## Модель даних

Finding (порушення), проблема (група порушень зі стабільним id), рішення (статус, коментар, ключ Jira), Screen.

## API, CLI, MCP

`vision-inspector audit` / `a11y` для CI; MCP `audit_screen` і `list_rules` (access.cli-mcp).

## Що зберігає

`A11Y_CONFIG` — правила, пороги, селектори назв екранів; `A11Y_ISSUE_STATES` — рішення команди; `JIRA_CONFIG`, `JIRA_MEMORY`. Рішення вивантажуються й завантажуються JSON-файлом. Спільної бази немає, тому джерелом правди про заведені баги є Jira (маркери).

## Тести

- `test/unit/a11y-engine.spec.ts`
- `test/unit/a11y-jira-bug.spec.ts`
- `test/unit/a11y-problems.spec.ts`
- `test/unit/a11y-rules.spec.ts`
- `test/unit/a11y-ui-tree.spec.ts`
- `test/unit/jira-bug-service.spec.js`
