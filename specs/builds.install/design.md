# Збірки з файлу: аналіз маніфесту й встановлення — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [3. Пристрій і сесія](../SPEC.md#device); стосується також: [9. Безпека](../SPEC.md#security).

## Де в коді й точка розширення

Дія (встановлення) й аналізатор (маніфест). Код: `app/common/node/builds/` (`zip.js`, `axml.js`, `plist.js`, `inspect.js`, `install.js`), `app/common/shared/findings/manifest-rules.js`, `app/common/renderer/components/Builds/BuildsTool.jsx`, `app/common/renderer/actions/Builds.js`.

## Модель даних

Artifact (збірка: файл, формат, платформа, appId, версія, збірка, підпис, маніфест), Finding.

## API, CLI, MCP

`vision-inspector build <файл>` — аналіз маніфесту для CI з кодом виходу за знахідками (access.cli-mcp).

## Що зберігає

`BUILDS_HISTORY` — останні збірки.

## Тести

- `test/unit/builds.spec.js`
