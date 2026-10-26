# Проксі: підміна, брейкпоінти, повтор запиту — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [7. API-клієнт і моки](../SPEC.md#api-client).

## Де в коді й точка розширення

Дія над трафіком. Код: `app/common/shared/proxy/mock-rules.js`, `app/common/node/proxy/server.js`, `app/common/renderer/components/Proxy/RulesDrawer.jsx`, `RuleEditor.jsx`, `ExchangeDetail.jsx`.

## Модель даних

Правило підміни: `id`, назва, метод, шаблон адреси, дія (відповідь, перенаправлення, обрив, затримка, брейкпоінт), увімкнене.

## API, CLI, MCP

Немає.

## Що зберігає

`PROXY_CONFIG.mockRules`, `mocksEnabled`, `breakpointsEnabled`.

## Тести

- `test/unit/proxy.spec.js`
