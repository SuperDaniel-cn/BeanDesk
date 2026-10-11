# Daily bookkeeping

## Principles

- Keep company books separate from personal spending.
- Record owner working-capital advances as liabilities, and paid-in capital as equity.
- Keep contract party, invoice header, and bank transfer aligned.
- Beancount `balance` assertions take effect at midnight on the stated date; use the first day of the next month for month-end cash checks.

## Dedup before posting

The assistant must search for duplicates and show a batch preview before changing `config/accounts.bean` or `data/`. Do not write until the user confirms. This is assistant discipline, not an automatic BeanDesk or `check_ledger` stop.

- Use the full statutory or contract id when the document has one: tag the posting `^inv-<full-number>` or `^ct-<full-contract>`. Do not store a short suffix as the link. Filenames may add `.inv-<full-number>` or `.ct-<full-contract>` after the date; see `document-filing.md`.
- Do not invent `^inv-` / `^rcpt-` serials for transfer screenshots, unnumbered receipts, bank slips, or postings with no external document (depreciation, interest, opening balances, payroll registers). A long bank reference is not a business key.
- Always search the workspace `data/` and `documents/` folders. A live Fava query is optional; a down Fava must not block posting.
- Hard match: search the full link and the full number in filenames. The last 8 digits may list candidates only; a suffix hit is not an automatic duplicate, and must not be written as `^link`.
- Fingerprint: when there is no statutory id or the hard match misses, compare posted entries within 7 days, with the exact same amount, and the same payee or the same income/expense account. Skip fingerprint checks for closing, depreciation, interest, opening balances, and payroll registers that have no external document.
- One confirmation card for the whole batch, whether one document or many: extracted fields and ids, dedup hits, accounts to open, and postings to write. On a hit, show the overlapping date, narration, and amount, and wait for the user to choose: same business sent twice (skip, or file the document only); installment or clearing (keep posting and attach the same `^inv-…`); or a separate business that happens to match the amount (post as new). List the options in the current conversation and wait; do not bind a specific host tool name.

## Posting steps

1. Read `base/` and any extra Markdown via `list_policies` / `get_policy`.
2. Confirm the account is `open` in `config/accounts.bean`. Cash accounts need `cash: TRUE`; income and expense accounts need `cashflow`.
3. File source documents under `documents/`.
4. Finish the dedup section above, show the batch preview, and write only after the user confirms.
5. Write the month file `data/YYYY/YYYY-MM.bean`. New month files must be `include`d from `data/YYYY/YYYY.bean`. Postings with a full document id get `^inv-<full-number>` or `^ct-<full-contract>`.
6. Run `check_ledger`. `ok` means syntax, balance, and machine rules matched (if configured); it is not a tax opinion and does not mean there are no duplicate postings.

```beancount
2026-03-15 * "Acme Corp" "Consulting retainer" #income ^inv-26312000000123456789
  Assets:Bank:Checking              50000.00 USD
  Income:Service:Consulting        -50000.00 USD
```
