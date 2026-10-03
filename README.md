# BeanDesk

A modern financial workbench for Beancount and Fava, built with React 19, TypeScript, Tailwind CSS, shadcn/ui, and Tauri 2. Operates both as a web application and a cross-platform desktop client.

The architecture is analogous to MetaCubeXD for Clash or AriaNg for Aria2: Fava serves as the underlying accounting engine, while BeanDesk acts as an independent presentation and workbench layer communicating directly with a local, private, or remote Fava instance without custom backend services or databases.

**English** | [简体中文](README.zh-CN.md)

[![Release](https://img.shields.io/github/v/release/SuperDaniel-cn/BeanDesk?color=blue)](https://github.com/SuperDaniel-cn/BeanDesk/releases)
[![License](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Sponsor](https://img.shields.io/badge/Sponsor-Crypto%20USDC-ea4aaa?logo=githubsponsors&logoColor=white)](#sponsorship)

![BeanDesk Trial Balance Preview](./docs/images/en/trial-balance.png)

## Quick Start

BeanDesk is a pure presentation workbench powered by a local or remote Fava instance.

### 1. Install Fava Engine

- **Developers (terminal one-liner)**:
  ```bash
  pip install fava
  ```
- **Ask your AI Agent (Cursor / Claude Code / terminal agent)**:
  > Copy prompt: *"Please install Python 3, Beancount, and Fava on my machine, initialize a minimal ledger `main.bean` in this folder, and start Fava on port 5000."*

For ledger initialization patterns and compliance guidelines, see the [Fava and Beancount Guide](skills/fava-beancount-guide/SKILL.md).

### 2. Run BeanDesk

- **Desktop App (Recommended)**: Run `make desktop`. Configure your ledger directory and startup command in Settings to supervise the process automatically, or connect directly to an existing Fava address.
- **Web Browser**: Once your Fava service is up, run `make dev` and open `http://127.0.0.1:5188`.

## Project Positioning and Roadmap

This project delivers a focused financial workbench for Beancount and Fava users, evolving toward compliance support for one-person companies, micro-teams, and solo founders.

Roadmap:

- Phase 1: Universal financial workbench. Complete three statutory statements: Balance Sheet, Income Statement, and direct-method Cash Flow Statement, alongside a side-by-side Trial Balance, global time filtering, and a native BQL console.
- Phase 2: One-person company compliance module. Shareholder loan and advance monitoring to prevent asset commingling and personal liability; tax provision estimates; three-way match checks between contracts, invoices, and bank statements; commercial delivery evidence archive.
- Phase 3: Out-of-the-box cross-platform desktop client. Built with Tauri 2, supporting one-click connection to local Fava, LAN NAS, or remote tunnels, with an automatic local process supervisor.

## Feature Boundaries and Non-Goals

To stay lightweight and focused on accounting rigor, this project excludes:

- Personal securities and portfolio tracking: No stock lot gain calculations, forex portfolios, or cryptocurrency scatter charts. The focus remains strictly on operating revenue, cost accounting, and corporate entity cash flows.
- Web-based ledger source editor: No inline text editing. Ledger files remain in desktop editors and local Git repositories. The web interface focuses on reports, drill-through, and document audit.
- Vanity visualizations: No charts. Reports are presented in dense, structured tables.
- Application-layer authentication: No user accounts, credentials database, or frontend login forms. Network security is delegated to infrastructure layers.

## Features

### Trial Balance
The default landing view. Presents account balances in a classical side-by-side debit and credit layout, verifying that total debits equal total credits across all roots. Supports tree expansion, keyword filtering, and drill-through links to the journal. Highlights imbalances clearly.

![Trial Balance](./docs/images/en/trial-balance.png)

### Three Financial Statements

#### Balance Sheet
Two-column layout rendering Fava's closed account tree. Retained period earnings are folded into the equity side, and currency-conversion plugs are excluded.

![Balance Sheet](./docs/images/en/balance-sheet.png)

#### Income Statement
Hierarchically displays operating revenue, expenses, and net profit.

![Income Statement](./docs/images/en/income-statement.png)

#### Cash Flow Statement
Direct method. Account categories map dynamically via metadata on the ledger's `open` directives: `cash` flags liquid assets, and `cashflow` assigns statutory line items. `cashflow-in` and `cashflow-out` split directional flows on the same account. Zero-balance lines are hidden and non-cash accruals are excluded.

![Cash Flow Statement](./docs/images/en/cash-flow.png)

### Global Time Filter
Switches reporting periods from the top navigation bar with support for all-time, annual, quarterly, or monthly filtering. Filter state propagates to the statements, the journal, and the query console.

### Interactive Journal
Provides a dense table view on desktop and card stream on mobile devices. Supports filtering by payee, narration, root account category, and tags. Selecting a transaction opens a dialog with full double-entry postings and document previews. In the desktop client, documents load securely through native byte streams.

![Interactive Journal](./docs/images/en/journal.png)

### BQL Query Console
Includes query templates, keyboard execution shortcuts, sortable table output, and CSV export. Numeric columns right-align automatically.

![BQL Query Console](./docs/images/en/query.png)

### Interface Details
- Mobile slide-out drawer navigation.
- Dark and light theme switching.
- Bilingual support in English and Simplified Chinese.

## Architecture

```
┌────────────────────────────────────────┐
│               Browser                  │
└───────────────────▲────────────────────┘
                    │ http://127.0.0.1:5188 (/api/fava)
┌───────────────────▼────────────────────┐
│         BeanDesk Web (Vite / Caddy)    │
└───────────────────▲────────────────────┘
                    │ /api/fava prefix stripped
                    │
┌───────────────────▼────────────────────┐       Native HTTP Plugin
│               Fava Engine              │ ◄────────────────────── ┌────────────────────────────────────────┐
│         http://127.0.0.1:5000          │                         │        BeanDesk Desktop (Tauri 2)      │
└───────────────────▲────────────────────┘                         │    - Local settings & direct remote    │
                    │                                              │    - Local Fava supervisor lifecycle   │
┌───────────────────┴────────────────────┐                         └────────────────────────────────────────┘
│       User Plain-Text Ledger (.bean)   │
└────────────────────────────────────────┘
```

## Running and Development

### Web Browser Mode

1. Prerequisites:
   - Package manager: Bun 1.1 or higher
   - Accounting engine: Local or private network Fava instance (default address `http://127.0.0.1:5000`)

2. Steps:
   ```bash
   make install
   make dev
   ```
   Open `http://127.0.0.1:5188`. The development proxy forwards `/api/fava` directly to your local Fava instance.

### Desktop Client Mode (Tauri 2)

From the repo root:

```bash
make desktop
```

The desktop shell connects directly to Fava via Tauri's native HTTP layer, bypassing browser CORS and mixed-content restrictions. Settings provides two operation modes:

- **Local project mode**: Choose your ledger directory and startup command (e.g. `make run` or `fava main.bean`). The client checks the port, spawns the background process group on demand, and cleans it up upon exit.
- **Connect-only mode**: Enter the origin of an existing Fava instance. Accessing remote servers over private overlay networks like Tailscale or WireGuard is strongly recommended.

![BeanDesk Desktop Settings & Supervisor](./docs/images/en/settings.png)

The desktop client runs cross-platform on macOS, Windows, and Linux, with built-in update checks and live connection logs.

## Deployment and Security Guidelines

Fava's API executes arbitrary BQL queries and serves document files. Never expose the service port directly to a public IP.

Recommended deployment:

1. Loopback binding: Bind Fava and frontend services to 127.0.0.1 without exposing public inbound ports.
2. Remote access:
   - Cloudflare Tunnel and Access: Route traffic through a secure tunnel with email PIN or SSO authentication.
   - Tailscale or WireGuard: Access through a private virtual network restricted to authorized devices.

The bind order, Caddy reverse proxy, and SPA fallback are documented in [DEPLOY.md](DEPLOY.md).

## Directory Structure and Specifications

```
BeanDesk/
├── AGENTS.md               # Frontend engineering standards and agent contract
├── DEPLOY.md               # Loopback bind, Caddy proxy, and tunnel setup
├── docs/
│   └── images/             # Product screenshots (EN & ZH)
├── skills/                 # AI agent skill definitions
│   └── fava-beancount-guide/ # Guide for user-managed ledgers and compliance
├── README.md               # English documentation (default)
├── README.zh-CN.md         # Chinese documentation (简体中文)
├── src-tauri/              # Tauri 2 desktop client shell
└── web/                    # Frontend source code
    ├── package.json
    ├── vite.config.ts
    ├── components.json
    └── src/
        ├── components/     # Reusable UI and layout components
        ├── pages/          # Pages: Trial Balance, Balance Sheet, Income Statement, Cash Flow, Journal, BQL Console
        ├── lib/            # Data adapters, cash flow pure functions, and API clients
        └── i18n/           # Translation catalogues
```

For ledger setup, version compatibility, and bookkeeping guidelines, see the [Fava and Beancount Guide](skills/fava-beancount-guide/SKILL.md). For frontend engineering standards, see [AGENTS.md](AGENTS.md).

## Testing and Building

Run inside the web directory:

```bash
bun test
bun run build
```

## Sponsorship

BeanDesk is free and open-source. If it saves your time, consider supporting its development:

- **USDC (Solana)**: `CiZxojzWpKwXqxqbQQ8gN6Qb4pdGSuKzYA9MbX8ukFKK`
- **USDC (Base / Arbitrum / Ethereum)**: `0x43ad55b5fe79d1d8afee3425a6011cfb9a512927`

## License

Licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](./LICENSE).

