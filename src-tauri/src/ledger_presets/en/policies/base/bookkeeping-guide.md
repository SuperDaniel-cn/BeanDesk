# Daily bookkeeping

## Principles

- Keep company books separate from personal spending.
- Record owner working-capital advances as liabilities, and paid-in capital as equity.
- Keep contract party, invoice header, and bank transfer aligned.
- Beancount `balance` assertions take effect at midnight on the stated date; use the first day of the next month for month-end cash checks.

## Posting steps

1. Read `base/` and any extra Markdown via `list_policies` / `get_policy`.
2. Confirm the account is `open` in `config/accounts.bean`. Cash accounts need `cash: TRUE`; income and expense accounts need `cashflow`.
3. File source documents under `documents/`.
4. Write the month file `data/YYYY/YYYY-MM.bean`. New month files must be `include`d from `data/YYYY/YYYY.bean`.
5. Run `check_ledger`. `ok` means syntax, balance, and machine rules matched (if configured); it is not a tax opinion.

```beancount
2026-03-15 * "Acme Corp" "Consulting retainer" #income #invoice
  Assets:Bank:Checking              50000.00 USD
  Income:Service:Consulting        -50000.00 USD
```
