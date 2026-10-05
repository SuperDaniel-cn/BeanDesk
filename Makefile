.PHONY: install dev desktop build test engine restic clean help docs docs-install docs-build docs-sync

PORT ?= 5188
FAVA_URL ?= http://127.0.0.1:5000

help:
	@echo "BeanDesk development commands:"
	@echo "  make install  - Install frontend dependencies with bun"
	@echo "  make dev      - Start the browser app on http://127.0.0.1:$(PORT)"
	@echo "  make desktop  - Start the Tauri window (Bun starts Vite; not npm run tauri dev)"
	@echo "  make build    - Build static production bundle"
	@echo "  make test     - Lint, typecheck tests, and run frontend and desktop tests"
	@echo "  make engine   - Freeze the bundled Fava engine directory for this machine"
	@echo "  make restic   - Fetch the pinned restic binary for this machine"
	@echo "  make clean    - Remove node_modules and dist artifacts"
	@echo "  make docs     - Preview the Fumadocs handbook at http://127.0.0.1:3200/docs"
	@echo "  make docs-sync - Export the handbook into web/public/docs"

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

engine:
	@bash engine/build.sh

restic:
	@bash engine/fetch-restic.sh

docs-install:
	cd docs && bun install

docs:
	cd docs && bun run dev

docs-build:
	cd docs && bun run build

docs-sync:
	bun docs/sync.mjs

clean:
	rm -rf web/node_modules web/dist .engine-venv engine/build engine/dist src-tauri/binaries/engine src-tauri/binaries/restic
