# Налаштування: інтеграції, збірки, пристрої — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [2. Робоча станція](../SPEC.md#shell).

## Де в коді й точка розширення

Панель UI. Код: `app/common/renderer/components/Settings/`, `app/common/renderer/components/Jira/JiraSettingsModal.jsx`, `app/common/renderer/components/AiSettings/AiSettingsModal.jsx`, `app/electron/main/secrets.js`.

## Модель даних

Налаштування (`electron-settings`) й секрети (`safeStorage`).

## API, CLI, MCP

Немає.

## Що зберігає

`JIRA_CONFIG`, `GITLAB_CONFIG`, `AI_CONFIG`, `IOS_SIGNING`, `BUILD_JOBS`, мова й тема.

## Тести

Немає.
