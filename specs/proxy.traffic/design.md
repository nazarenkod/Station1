# Проксі: перехоплення, домени, прапорці трафіку — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [4. Телеметрія](../SPEC.md#telemetry); стосується також: [5. Прапорці](../SPEC.md#flags), [9. Безпека](../SPEC.md#security).

## Де в коді й точка розширення

Джерело даних (трафік) і аналізатор (правила трафіку). Код: `app/common/node/proxy/server.js`, `app/common/shared/findings/traffic-rules.js`, `app/common/renderer/components/Proxy/`.

## Модель даних

Exchange (запит і відповідь, тайминги, прапорці), Finding (`traffic-error`, `traffic-slow`, `traffic-duplicate`), Endpoint (метод і шлях без змінних частин).

## API, CLI, MCP

Немає.

## Що зберігає

`PROXY_CONFIG`: порт, правила трафіку (пороги), режими. Сертифікат CA — у теці застосунку, ключ з правами 600.

## Тести

- `test/unit/proxy-hosts.spec.js`
- `test/unit/proxy.spec.js`
