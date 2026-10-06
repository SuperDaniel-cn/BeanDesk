# BeanDesk

> Local-first financial workbench for one-person companies and private management accounting.

BeanDesk is a modern, local-first double-entry financial workbench and desktop client for solopreneurs, one-person companies (OPCs), micro-teams, and financial managers. Built on top of Beancount and Fava, BeanDesk operates with zero custom backends and no centralized database, bridging regulatory compliance, three-way match audit trails, and private internal management accounting.

Fava serves as the underlying general ledger and calculation engine, while BeanDesk acts as an independent presentation and workbench layer, connecting directly to a local or private-network Fava instance.

**English** | [简体中文](README.zh-CN.md)

[![Release](https://img.shields.io/github/v/release/SuperDaniel-cn/BeanDesk?color=blue)](https://github.com/SuperDaniel-cn/BeanDesk/releases)
[![License](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Sponsor](https://img.shields.io/badge/Sponsor-Payoneer%20%2F%20Crypto-ea4aaa?logo=githubsponsors&logoColor=white)](#sponsorship)

![BeanDesk Trial Balance Preview](./docs/images/en/trial-balance.png)

## Core Features

### Trial Balance
The default landing view. Presents account balances in a classical side-by-side debit and credit layout, verifying that total debits equal total credits across all roots. Supports full account tree expansion, instant keyword filtering, and direct drill-through into the journal. Highlights any imbalance clearly.

![Trial Balance](./docs/images/en/trial-balance.png)

### Three Statutory Financial Statements

#### Balance Sheet
Two-column balanced layout rendering the closed account tree. Automatically rolls current-period earnings into equity and filters out currency-conversion plugs.

![Balance Sheet](./docs/images/en/balance-sheet.png)

#### Income Statement
Hierarchically breaks down operating revenue, operating expenses, taxes, and net profit to clearly present operating performance.

![Income Statement](./docs/images/en/income-statement.png)

#### Cash Flow Statement (Direct Method)
Computed client-side as pure functions. Dynamically mapped via metadata on the ledger's `open` directives: `cash` marks liquid funds, `cashflow` specifies statutory reporting line items, and `cashflow-in` / `cashflow-out` distinguish directional flows. Automatically hides zero-balance rows and filters out non-cash accruals.

![Cash Flow Statement](./docs/images/en/cash-flow.png)

### Global Time Filter
Switch between all-time, annual, quarterly, or monthly periods directly from the top navigation bar. Selected timeframes synchronize instantly across all financial statements, the journal, and the BQL query console.

### Interactive Journal & Document Audit Trail
Dense table layout on desktop and adaptive card stream on mobile devices. Supports filtering by payee, narration, account category, and tags. Clicking any transaction opens a detailed dialog with double-entry postings; on desktop, associated invoices and bank receipts are previewed directly through secure native byte streams.

![Interactive Journal & Document Audit Trail](./docs/images/en/journal.png)

### Native BQL Query Console
Equipped with common financial query templates, keyboard shortcuts, sortable table output, and CSV export. Numeric columns automatically right-align for convenient analysis.

![BQL Query Console](./docs/images/en/query.png)

### Out-of-the-Box Cross-Platform Desktop Client (Tauri 2)
- **Bundled Engine Sidecar**: Includes a self-contained runtime environment out of the box—no pre-installed Python or virtual environment required.
- **Intelligent Lifecycle Supervisor**: Probes ports before launch; connects instantly if Fava is already running, or launches and manages an isolated process group that terminates cleanly on exit.
- **First-Book Skeleton Initialization**: Generates a standardized account hierarchy (`main.bean`) and initial configuration in an empty directory with one click.
- **Dual Local Backup System**:
  - **Automated Git Snapshots**: Debounced file-watcher captures ledger and document changes in real time as local version snapshots.
  - **restic Strong Encryption**: Incremental backups on demand or automatically to multiple local destinations and S3-compatible buckets (Cloudflare R2, MinIO, AWS S3). Passwords and credentials are provided via isolated files or environment variables without exposing plaintext in process arguments.

![Desktop Settings & Backup Management](./docs/images/en/settings.png)

### Tax Calendar & Due-Date Reminders
Supports local `.ics` files and standard HTTPS iCal subscription feeds (e.g., Google Calendar or Outlook published links). Events due within 7 days trigger desktop system notifications and in-app banners while the app is running.

### Local MCP Server (Model Context Protocol)
The desktop binary speaks stdio MCP when launched with the `mcp` argument. Settings provides a one-click copyable configuration for AI assistants such as Cursor and Claude Desktop. Supports read-only BQL execution, statement retrieval, journal and document directory inspection, syntax checks, and ledger skeleton initialization.

### Built-in Offline User Handbook
Includes an embedded Fumadocs handbook opened in a dedicated hot-loaded window, accessible offline anytime without an internet connection.

## Design Principles & Boundaries

- **Zero Cloud Data Exposure**: Plain-text ledgers and supporting documents remain strictly on your local machine. BeanDesk never hosts ledgers in the cloud or tracks personal financial data.
- **Single-Instance Simplicity**: Connects to a single Fava service. Multiple ledgers are managed via Fava's native multi-file root options and URL slugs without complex multi-tenant switching.
- **Read-Only Reporting & Compliance**: Positioned as a reporting workbench and compliance evidence browser. Creating and modifying transactions is left to text editors or local AI agent skills, preserving the simplicity of plain text.
- **Strict Tabular Presentation**: Financial clarity over decoration. All reports use high-density structured tables rather than unnecessary charts.

## Quick Start

### Option 1: Download Desktop Application (Recommended)

Visit the [Releases](https://github.com/SuperDaniel-cn/BeanDesk/releases) page to download the installer for your operating system:

- **macOS**: Apple Silicon (`.dmg`) and Intel (`.dmg`).
- **Windows**: 64-bit installer (`.exe`).
- **Linux**: x86_64 and ARM64 packages (`.deb` / `.AppImage`).

After launching, open Settings:
1. **New Ledger**: Choose an empty work folder and click "Initialize Ledger" to generate a standard `main.bean` skeleton.
2. **Existing Ledger**: Select your directory. Leave the launch command empty to use the bundled engine, or specify a custom command (e.g., `fava main.bean`).
3. **Connect to Running Service**: If Fava is already running locally or on your LAN, enter its origin directly.

### Option 2: Run from Source

Prerequisites: **Bun 1.1+** for frontend packages, and the **Rust** toolchain for desktop builds.

```bash
# 1. Clone repository and install dependencies
git clone https://github.com/SuperDaniel-cn/BeanDesk.git
cd BeanDesk
make install

# 2. Run desktop client (recommended)
make desktop

# Or run web browser client (port 5188, proxying /api/fava to 5000)
make dev

# 3. Run complete test suite (Linter, typecheck, web & Rust unit tests)
make test
```

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
                    │                                              │    - Bundled engine lifecycle supervisor│
┌───────────────────┴────────────────────┐                         │    - Local Git & restic encrypted backup│
│       User Plain-Text Ledger (.bean)   │                         │    - Local stdio MCP & offline handbook │
└────────────────────────────────────────┘                         └────────────────────────────────────────┘
```

## Deployment & Security Guidelines

Fava's API executes arbitrary BQL queries and serves documents; never expose the Fava port directly to a public IP.

Recommended deployment strategies:
1. **Loopback Binding**: Bind Fava and the frontend strictly to `127.0.0.1`.
2. **Secure Remote Access**:
   - **Private Virtual Network**: Use Tailscale or WireGuard to restrict access to trusted devices.
   - **Zero Trust Tunnel**: Deploy Cloudflare Tunnel with Cloudflare Access protection (e.g., One-Time PIN email verification).

Refer to [DEPLOY.md](DEPLOY.md) for full reverse-proxy and tunnel configurations.

## Directory Structure

```
BeanDesk/
├── AGENTS.md               # Engineering standards and agent contract
├── DEPLOY.md               # Loopback bind, Caddy reverse-proxy, and tunnel setup
├── docs/                   # Handbook source (Fumadocs) and screenshots
│   ├── content/docs/       # Handbook markdown pages (ZH & EN)
│   └── images/             # Product screenshots (zh / en)
├── skills/                 # AI agent bookkeeping skills
│   └── fava-beancount-guide/ # Bookkeeping guides and compliance entries
├── src-tauri/              # Tauri 2 desktop application (Rust)
├── web/                    # Frontend application (React 19, TypeScript, Tailwind CSS, shadcn/ui)
│   ├── src/pages/          # Pages: Trial Balance, Balance Sheet, Income Statement, Cash Flow, Journal, BQL Console, Calendar, Settings
│   ├── src/lib/            # Cash flow calculation, data adapters, API client
│   └── src/i18n/           # Internationalization dictionaries
├── Makefile                # Automation commands
├── README.md               # English documentation
└── README.zh-CN.md         # Simplified Chinese documentation
```

## Sponsorship

BeanDesk is free and open-source. If it saves your time, consider supporting its development:

- **Payoneer**: [Support via Payoneer](https://link.payoneer.com/Token?t=D6ADDF769F5F4EE7B8F8F188A32AE50C&src=pl)
- **USDC (Solana)**: `CiZxojzWpKwXqxqbQQ8gN6Qb4pdGSuKzYA9MbX8ukFKK`
- **USDC (Base / Arbitrum / Ethereum)**: `0x43ad55b5fe79d1d8afee3425a6011cfb9a512927`

## License

Licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](./LICENSE).
