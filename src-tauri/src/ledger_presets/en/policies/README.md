# Bookkeeping policies

Standard account naming, document filing, and bookkeeping procedures for this ledger live in `base/`. Additional Markdown files placed in this directory serve as custom business policies for AI assistants. TOML files define automated compliance rules executed by `check_ledger` after syntax and balance verification.

Each TOML rule requires an effective start date `from` (inclusive), an optional expiration date `until` (exclusive), and exactly one validation action: `require_tag`, `require_payee`, `narration_regex`, `posting_sign`, `forbidden_accounts`, or `account_pattern`.

```toml
[[rules]]
id = "payroll-tag"
description = "Payroll postings must carry the #payroll tag"
severity = "error"
from = "2026-01-01"
account = "Expenses:Payroll"
require_tag = "payroll"
```
