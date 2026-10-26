# ШІ-перевірка екрана з приховуванням даних — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [8. Доступність](../SPEC.md#a11y).

## Де в коді й точка розширення

Аналізатор та інтеграція. Код: `app/common/renderer/lib/a11y/ai.ts`, `app/common/node/ai/`, `app/common/renderer/components/AiSettings/`, `app/common/renderer/components/SessionInspector/A11yTab/AiPanel.jsx`.

## Модель даних

Finding із джерелом «ШІ», кеш відповідей `ai-cache.json`, лічильник викликів за день.

## API, CLI, MCP

Немає.

## Що зберігає

`AI_CONFIG`: постачальник, модель, дозвіл, ліміт, шаблони приховування. Ключ Gemini — у Keychain.

## Тести

- `test/unit/a11y-ai.spec.ts`
