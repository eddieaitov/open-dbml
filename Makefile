.PHONY: help install start web docker-build docker-up docker-down clean

help: ## Показать эту справку
	@echo '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
	@echo '  ui-db — DBML Editor                  '
	@echo '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
	@echo '  make install      npm install'
	@echo '  make start        Запуск Electron (десктоп)'
	@echo '  make web          Запуск веб-сервера (http://localhost:7924)'
	@echo '  make docker-build Сборка Docker-образа'
	@echo '  make docker-up    Запуск в Docker (http://localhost:7924)'
	@echo '  make docker-down  Остановить Docker'
	@echo '  make clean        Очистка node_modules'
	@echo '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'

install: ## npm install
	npm install

start: ## Запуск в режиме Electron (десктоп)
	npm start

web: ## Запуск веб-сервера на порту 7924
	node serve.js

docker-build: ## Сборка Docker-образа
	docker compose build

docker-up: ## Запуск в Docker
	docker compose up -d
	@echo ''
	@echo '  🌐 http://localhost:7924'
	@echo ''

docker-down: ## Остановить Docker
	docker compose down

clean: ## Очистка
	rm -rf node_modules
	@echo '  node_modules удалён'
