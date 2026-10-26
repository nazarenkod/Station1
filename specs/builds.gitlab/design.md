# Збірки з пайплайнів GitLab за посиланням — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [3. Пристрій і сесія](../SPEC.md#device).

## Де в коді й точка розширення

Інтеграція (GitLab) й дія (встановлення). Код: `app/common/shared/builds/pipelines.js`, `app/common/node/gitlab/service.js`, `app/common/node/builds/artifacts.js`, `app/common/renderer/components/Builds/` (`pipeline-watch.js`, `PipelinePanel.jsx`, `BuildRuleEditor.jsx`), `app/common/renderer/components/Settings/BuildSourcesSettings.jsx`.

## Модель даних

Правило джерела збірки: `project`, `virtual {jobs, file}`, `real {jobs, file}`. Відстежуваний пайплайн: посилання, цільові пристрої, автовстановлення, збірки за типом пристрою (джоба, стан, файл, збірка, встановлення). Artifact.

## API, CLI, MCP

Немає.

## Що зберігає

`BUILD_JOBS` — правила й вибори файлів; `PIPELINE_WATCHES` — незавершені пайплайни. Архіви: останні 5 джоб у теці застосунку.

## Тести

- `test/unit/gitlab-pipeline.spec.js`
- `test/unit/pipeline-watch.spec.js`
- `test/unit/pipelines.spec.js`
