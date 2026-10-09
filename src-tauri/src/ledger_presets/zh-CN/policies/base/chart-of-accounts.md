# 科目命名与按需开立

BeanDesk 报表读取 `open` 中的完整路径，按冒号切分每段并提取每段最后一个连字符后的中文部分做界面展示（若段落末尾不含汉字则不提取）。行末注释不能代替科目名里的中文。

## 格式

```
根账户:大写英文分类-中文类别:大写英文子级-中文明细
```

示例：`Assets:Bank-银行存款:Main-基本户`、`Income:Service-主营业务收入:Consulting-架构咨询服务`。

## 结构规则

1. 根账户只能是 `Assets`、`Liabilities`、`Equity`、`Income`、`Expenses`。
2. 根级以下每一段必须以大写英文字母开头，接着连字符 `-`，再写中文名称。段首不能是数字或汉字。连字符后可以夹有 ASCII（如 `Main-XX银行对公户`）。
3. 连字符是科目名的一部分。日记账等处提取每段最后一个连字符后的中文并以 ` · ` 拼接；树形报表按层级树展开，各层级节点（包括父级类别与明细科目）均提取连字符后的中文显示。
4. 凭证目录与科目层级一致，连字符留在文件夹名中。

账本初始化时仅开立基本户与实收资本两个通用基础账户。以下科目为小微企业通用推荐字典，由财务或 AI 助手根据企业真实业务类型在 `config/accounts.bean` 中按需开立（open），并配置对应的现金流元数据。

## 资产

```beancount
2020-01-01 open Assets:Bank-银行存款:Main-基本户 CNY
  cash: TRUE
2020-01-01 open Assets:Payment-对公支付:Corporate-XX支付备用金 CNY
  cash: TRUE
2020-01-01 open Assets:Prepaid-预付账款:Rent-办公租金 CNY
2020-01-01 open Assets:FixedAssets-固定资产:Computers-研发电脑 CNY
  cashflow: "capex"
2020-01-01 open Assets:FixedAssets-固定资产:Office-办公设备 CNY
  cashflow: "capex"
```

资金账户必须标记 `cash: TRUE`。

## 负债

```beancount
2020-01-01 open Liabilities:Owner-股东往来:Advance-法人垫资借款 CNY
  cashflow-in: "borrowings"
  cashflow-out: "debt-principal"
2020-01-01 open Liabilities:Tax-应交税费:VAT-应交增值税 CNY
  cashflow: "taxes"
2020-01-01 open Liabilities:AccountsPayable-应付账款:Vendor-供应商货款 CNY
```

## 权益

```beancount
2020-01-01 open Equity:Capital-实收资本:PaidIn-股东出资 CNY
  cashflow: "capital"
```

## 收入

根据企业真实业务类型选用开立，主营业务收入标记 `cashflow: "sales"`，营业外利息收入标记 `cashflow: "operating-other-in"`：

```beancount
2020-01-01 open Income:Service-主营业务收入:Consulting-架构咨询服务 CNY
  cashflow: "sales"
2020-01-01 open Income:Service-主营业务收入:Design-设计制作服务 CNY
  cashflow: "sales"
2020-01-01 open Income:Revenue-主营业务收入:Goods-商品销售收入 CNY
  cashflow: "sales"
2020-01-01 open Income:Other-营业外收入:Interest-银行利息收入 CNY
  cashflow: "operating-other-in"
```

## 成本与费用

根据支出性质选用开立，并配置对应的现金流分类标签：

```beancount
2020-01-01 open Expenses:Operations-主营业务成本:Cloud-云计算与算力 CNY
  cashflow: "purchases"
2020-01-01 open Expenses:Operations-主营业务成本:SaaS-开发工具订阅 CNY
  cashflow: "purchases"
2020-01-01 open Expenses:Operations-管理费用:Rent-办公场地租金 CNY
  cashflow: "operating-other-out"
2020-01-01 open Expenses:Operations-管理费用:Office-办公耗材通信 CNY
  cashflow: "operating-other-out"
2020-01-01 open Expenses:Operations-销售费用:Travel-差旅交通住宿 CNY
  cashflow: "operating-other-out"
2020-01-01 open Expenses:Operations-销售费用:Meals-业务招待餐饮 CNY
  cashflow: "operating-other-out"
2020-01-01 open Expenses:Payroll-员工薪酬:Salary-员工基本工资 CNY
  cashflow: "wages"
2020-01-01 open Expenses:Payroll-员工薪酬:SocialSecurity-单位社保公积金 CNY
  cashflow: "wages"
2020-01-01 open Expenses:Tax-税金及附加:Surcharges-城建及教育附加 CNY
  cashflow: "taxes"
2020-01-01 open Expenses:Financial-财务费用:BankFee-网银手续费 CNY
  cashflow: "operating-other-out"
```
