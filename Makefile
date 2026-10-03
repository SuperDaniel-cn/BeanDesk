.PHONY: install dev desktop build test clean help

PORT ?= 5188
FAVA_URL ?= http://127.0.0.1:5000

help:
	@echo "BeanDesk development commands:"
	@echo "  make install  - Install frontend dependencies with bun"
	@echo "  make dev      - Start the browser app on http://127.0.0.1:$(PORT)"
	@echo "  make desktop  - Start the Tauri window (Bun starts Vite; not npm run tauri dev)"
	@echo "  make build    - Build static production bundle"
	@echo "  make test     - Lint, typecheck tests, and run frontend and desktop tests"
	@echo "  make clean    - Remove node_modules and dist artifacts"

install:
	cd web && bun install

dev:
	cd web && FAVA_URL="$(FAVA_URL)" bun run dev -- --port $(PORT)

# The repo root is not a Node package. Tauri's dev command runs from src-tauri
# and starts the existing Vite app in web/.
desktop:
	bunx @tauri-apps/cli dev

build:
	cd web && bun run build

test:
	cd web && bun run lint
	cd web && bunx tsc -p tsconfig.test.json --noEmit
	cd web && bun test
	cargo test --manifest-path src-tauri/Cargo.toml

clean:
	rm -rf web/node_modules web/dist
