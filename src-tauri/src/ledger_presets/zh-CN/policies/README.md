# Bookkeeping policies

Standard account naming, document filing, and bookkeeping procedures for this ledger live in `base/`. Additional Markdown files placed in this directory serve as custom business policies for AI assistants. TOML files define automated compliance rules executed by `check_ledger` after syntax and balance verification.

Each TOML rule requires an effective start date `from` (inclusive), an optional expiration date `until` (exclusive), and exactly one validation action: `require_tag`, `require_payee`, `narration_regex`, `posting_sign`, `forbidden_accounts`, or `account_pattern`.

# 记账策略与合规指引

本账本的标准科目命名规范、凭证归档说明与日常记账流程存放于 `base/` 目录。在此目录下创建的其它 Markdown 文件，可作为企业自建的业务规章与财务制度供 AI 助手阅读遵循。此目录下的 `.toml` 文件用于定义由 `check_ledger` 在底层语法与借贷平衡检查后自动执行的机器合规规则。

每条 TOML 规则需配置生效起始日期 `from`（含当天），可选配置失效日期 `until`（不含当天，左闭右开），并指定一项检查动作（require_tag, require_payee, narration_regex, posting_sign, forbidden_accounts, 或 account_pattern）。

```toml
[[rules]]
id = "payroll-tag"
description = "薪酬支出必须附带 #payroll 标签"
severity = "error"
from = "2026-01-01"
account = "Expenses:Payroll-员工薪酬"
require_tag = "payroll"
```
