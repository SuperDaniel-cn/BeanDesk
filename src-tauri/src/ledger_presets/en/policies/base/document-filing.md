# Document filing

Declare `option "documents" "documents"` in `main.bean`. Fava scans `documents/`; BeanDesk links matching files in the journal.

## Path rules

1. Replace `:` in the account path with `/`.
2. Keep each account segment as one folder name. Do not split a hyphenated segment into two folders.
3. Name files `YYYY-MM-DD.note.ext`. The date must match the posting date. When the document has a statutory or contract id, use `YYYY-MM-DD.inv-<full-number>.note.ext` or `YYYY-MM-DD.ct-<full-contract>.note.ext`. Write the full number; do not store a short suffix, and do not invent `inv-` / `rcpt-` serials for unnumbered receipts, transfer screenshots, or bank slips. Unnumbered files stay `YYYY-MM-DD.note.ext`.

## Examples

| Account | Directory |
| --- | --- |
| Assets:Bank:Checking | documents/Assets/Bank/Checking/ |
| Income:Service:Consulting | documents/Income/Service/Consulting/ |

```
documents/Assets/Bank/Checking/2026-03-15.deposit-slip.pdf
documents/Income/Service/Consulting/2026-03-15.inv-26312000000123456789.invoice.pdf
```

Files link to transactions by matching date and account folder path, or by including the transaction's link tag (declared via `^link` without the caret prefix) in the filename. If neither matches, the journal document pill remains inactive.
