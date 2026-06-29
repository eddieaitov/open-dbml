# ui-db

Визуальный редактор схем баз данных для файлов **DBML**.

![screenshot](https://img.shields.io/badge/electron-33-blue) ![node](https://img.shields.io/badge/node-%3E%3D20-green)

## Возможности

- **Редактор DBML** — CodeMirror 5 с подсветкой синтаксиса SQL, тёмная тема (Dracula)
- **Визуализация схемы** — таблицы отображаются в виде карточек с колонками, типами и бейджами (PK, FK, UQ, NN)
- **Связи** — Bezier-curve SVG-линии между связанными таблицами
- **Перетаскивание** — расположите таблицы мышью; позиции сохраняются автоматически
- **Цвет хэдера** — палитра из 16 цветов, индивидуально для каждой таблицы
- **Проверка синтаксиса** — подсветка ошибок: непарные скобки, ссылки на несуществующие таблицы
- **Autosave** — автосохранение с дебаунсом 500 мс (для файлов на диске)

## Быстрый старт

```bash
git clone <repo> ui-db
cd ui-db
npm install

# Electron (десктоп)
npm start

# или веб-версия в браузере
node serve.js
# → http://localhost:7924
```

## Управление

| Действие | Кнопка | Хоткей |
|---|---|---|
| Новая схема | 📄 New | `⌘N` |
| Открыть файл | 📂 Open | `⌘O` |
| Сохранить | 💾 Save | `⌘S` |
| Сохранить как | 💾 Save As… | `⇧⌘S` |
| Auto-arrange | ⟳ Arrange | — |

## Формат файлов

ui-db работает с файлами `.dbml` (Database Markup Language).

Позиции и цвета таблиц сохраняются в файл `<имя>.dbml.positions.json` рядом с DBML-файлом.

## Два режима запуска

### Electron (десктоп)

Полноценное приложение с нативными диалогами открытия/сохранения файлов.

```bash
npm start
```

### Web (браузер)

Редактор доступен в браузере. Файлы загружаются через `input[type=file]`, сохраняются через Blob download. Позиции таблиц хранятся в `localStorage`.

```bash
node serve.js
# или make web
```

## Docker

```bash
make docker-build   # сборка образа
make docker-up      # запуск → http://localhost:7924
make docker-down    # остановка
```

Порт по умолчанию: **7924**.

## Makefile

| Команда | Описание |
|---|---|
| `make install` | `npm install` |
| `make start` | Electron (десктоп) |
| `make web` | Веб-сервер (http://localhost:7924) |
| `make docker-build` | Сборка Docker-образа |
| `make docker-up` | Запуск в Docker |
| `make docker-down` | Остановка Docker |
| `make clean` | Удаление `node_modules` |

## Технологии

- **Electron 33** — десктопная оболочка
- **CodeMirror 5** — редактор кода
- **Node.js** — веб-сервер (serve.js)
- **Docker** — контейнеризация web-режима
