# Проксі: перехоплення, домени, прапорці трафіку — як зроблено

> Дизайн до контракту [spec.md](spec.md): що й навіщо — там, тут — де в коді, які дані, що зберігає. Частина [основної специфікації](../SPEC.md), розділ [4. Телеметрія](../SPEC.md#telemetry); стосується також: [5. Прапорці](../SPEC.md#flags), [9. Безпека](../SPEC.md#security).

## Де в коді й точка розширення

Джерело даних (трафік) і аналізатор (правила трафіку). Код: `app/common/node/proxy/server.js`, `app/common/shared/findings/traffic-rules.js`, `app/common/renderer/components/Proxy/`.

## Модель даних

Exchange (запит і відповідь, тайминги, прапорці), Finding (`traffic-error`, `traffic-slow`, `traffic-duplicate`, `traffic-contract`), Endpoint (метод і шлях без змінних частин).

## Правила трафіку

`TRAFFIC_RULES` у `traffic-rules.js` — значення за замовчуванням; `PROXY_CONFIG.trafficRules` змінює їх по групах.

- **Дублі.** `duplicateSignature` складає підпис: метод, адреса з query без `ignoreParams` (параметри відсортовано) чи без query (`query: 'none'`), тіло без `ignoreFields` (назва — на будь-якій глибині, шлях з крапкою — від кореня; ключі JSON відсортовано) чи без тіла (`body: 'none'`). `expected` — рядки `poll` / `allow` / `ignore` (`parseExpectedRepeat`), перший, що підійшов, замінює загальне правило вікна. Старий список `ignore` читається як рядки `ignore`; вікно правил переписує його в `expected` під час збереження.
- **Контракт.** `contract.required` — рядки `parseRequirement`. Заголовки шукаються без огляду на регістр (mockttp дає їх малими літерами); поля тіла — лише в 2xx, не обрізаній відповіді; не JSON — поле відсутнє. Відсутнє лягає в `exchange.missing`.
- **Повільно.** `slowLimitFor` повертає поріг і рядок, звідки він; сервер кладе його в `exchange.slowLimit`, деталі запиту показують.

## API, CLI, MCP

Немає.

## Що зберігає

`PROXY_CONFIG`: порт, правила трафіку (пороги), режими. Сертифікат CA — у теці застосунку, ключ з правами 600.

## Тести

- `test/unit/proxy-hosts.spec.js`
- `test/unit/proxy.spec.js`
- `test/unit/traffic-rules.spec.js`
