# Chart of accounts

Open accounts in `config/accounts.bean` before posting. Initialization only opens a checking account and paid-in capital.

Cash accounts need `cash: TRUE`. Income, expense, and financing accounts need `cashflow` (or `cashflow-in` / `cashflow-out`).

## Assets

```beancount
2020-01-01 open Assets:Bank:Checking USD
  cash: TRUE
2020-01-01 open Assets:Receivable:Customers USD
2020-01-01 open Assets:Prepaid:Rent USD
2020-01-01 open Assets:FixedAssets:Equipment USD
  cashflow: "capex"
```

## Liabilities

```beancount
2020-01-01 open Liabilities:Owner:Advance USD
  cashflow-in: "borrowings"
  cashflow-out: "debt-principal"
2020-01-01 open Liabilities:Tax:Payable USD
  cashflow: "taxes"
2020-01-01 open Liabilities:AccountsPayable:Vendors USD
```

## Equity

```beancount
2020-01-01 open Equity:Capital:PaidIn USD
  cashflow: "capital"
```

## Income

```beancount
2020-01-01 open Income:Service:Consulting USD
  cashflow: "sales"
2020-01-01 open Income:Sales:Goods USD
  cashflow: "sales"
2020-01-01 open Income:Other:Interest USD
  cashflow: "operating-other-in"
```

## Expenses

```beancount
2020-01-01 open Expenses:Operations:Hosting USD
  cashflow: "purchases"
2020-01-01 open Expenses:Operations:Rent USD
  cashflow: "operating-other-out"
2020-01-01 open Expenses:Payroll:Salary USD
  cashflow: "wages"
2020-01-01 open Expenses:Tax:Surcharges USD
  cashflow: "taxes"
2020-01-01 open Expenses:Financial:BankFee USD
  cashflow: "operating-other-out"
```
