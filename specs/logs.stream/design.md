# Логи пристрою: фільтри, пошук, правила — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [4. Телеметрія](../SPEC.md#telemetry); стосується також: [5. Прапорці](../SPEC.md#flags).

## Де в коді й точка розширення

Джерело даних (лог) і аналізатор (правила логів). Код: `app/common/node/logs/`, `app/common/shared/findings/log-rules.js`, `app/common/renderer/components/Logs/` (`LogsTool.jsx`, `log-filter.js`, `logs-store.js`).

## Модель даних

Event (рядок логу: seq, час, pid, рівень, тег, повідомлення, чи належить застосунку, правила, що спрацювали), процес застосунку, Finding.

## API, CLI, MCP

Немає.

## Що зберігає

`LOG_RULES_CONFIG`: вимкнені чи змінені вбудовані правила й правила проєкту.

## Тести

- `test/unit/log-filter.spec.js`
- `test/unit/logs.spec.js`
