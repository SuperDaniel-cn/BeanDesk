# Document filing

Declare `option "documents" "documents"` in `main.bean`. Fava scans `documents/`; BeanDesk links matching files in the journal.

## Path rules

1. Replace `:` in the account path with `/`.
2. Keep each account segment as one folder name. Do not split a hyphenated segment into two folders.
3. Name files `YYYY-MM-DD.note.ext`. The date must match the posting date.

## Examples

| Account | Directory |
| --- | --- |
| Assets:Bank:Checking | documents/Assets/Bank/Checking/ |
| Income:Service:Consulting | documents/Income/Service/Consulting/ |

```
documents/Assets/Bank/Checking/2026-03-15.deposit-slip.pdf
documents/Income/Service/Consulting/2026-03-15.invoice.pdf
```

Files link to transactions by matching date and account folder path, or by including the transaction's link tag (declared via `^link` without the caret prefix) in the filename. If neither matches, the journal document pill remains inactive.
