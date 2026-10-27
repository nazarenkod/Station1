---
name: spec-feature
description: Use when adding a feature to Station#1 or changing how an existing one behaves (not for pure refactors or typo fixes). Walks the spec-driven process of this repo - spec, design and tasks, implementation, verification, commit - using specs/SPEC.md and the templates in specs/_templates.
---

# Фіча за спекою

Процес репозиторію (specs/SPEC.md, розділ 14) крок за кроком.

## 1. Знайти місце

- Прочитай `specs/SPEC.md`: до якого розділу (2–11) належить задача, чи є вже фіча (`specs/<id>/`).
- Є фіча — прочитай її `spec.md` і `design.md`. Немає — нова фіча з `id` вигляду `<область>.<фіча>` (як `proxy.traffic`).

## 2. Спека

- Нова фіча: скопіюй `specs/_templates/spec.md` у `specs/<id>/spec.md`, статус `draft`. Зміна: додай чи зміни критерії в наявному `spec.md`.
- Критерії — Given / When / Then, перевірювані; кожен скаже, яким тестом перевіриться.
- Додай фічу в таблицю її розділу в `SPEC.md` (і прибери з «Заплановано», якщо вона там була).
- **Зупинись і покажи користувачу** чернетку: проблему й критерії, коротко. Код — лише після його згоди (статус `approved`). Якщо користувач уже дав точне рішення в цьому ж запиті, а зміна мала (один-два критерії), можна записати критерії й одразу робити, сказавши про це.

## 3. Дизайн і план

- `specs/<id>/design.md` за шаблоном: де в коді (повні шляхи), дані, що зберігає, рішення.
- Робота більша за одну-дві правки — `specs/<id>/tasks.md`: маленькі кроки з файлами, тестом і номером критерію; [P] для незалежних.

## 4. Реалізація

- Логіку — в `app/common/shared/` чи `app/common/node/`, з тестами; інтерфейс лише викликає її (AGENTS.md).
- Код відходить від спеки — спершу онови `spec.md`.
- Відмічай задачі в `tasks.md`.

## 5. Перевірка

- `npx oxlint -c oxlint.config.mjs .`, `npx oxfmt -c oxfmt.config.mjs --check .`, `npx vitest run test/unit`.
- Наживо в `npm run dev:electron` на симуляторі чи емуляторі, де можливо. Що не перевірено — сказати прямо.
- Кожен критерій: `Тест: <файл>` або `Тест: немає`.

## 6. Коміт

- Статус `implemented`, таблиця розділу в `SPEC.md` оновлена, `tasks.md` видалено.
- Додавай файли поіменно (у теці працюють інші сесії); спека, дизайн, код і тести — одним комітом.
- Залити: `git -c http.postBuffer=524288000 push origin main` (правила — AGENTS.md, розділ «Git»).
- Користувачу — що змінилося, як перевірено, що не перевірено, з посиланням на спеку.
