# 日常记账

## 原则

- 财产独立：公司账只记对公经营收支，股东个人消费不入账。
- 垫资与出资分开：法人垫资记负债（如 `Liabilities:Owner-股东往来:Advance-法人垫资借款`），股东增资记权益（`Equity:Capital-实收资本:PaidIn-股东出资`）。还款摘要注明“还股东借款”或“还垫付款”。
- 三流一致：合同对手、发票抬头与银行转账主体保持一致。
- 月末余额：Beancount 的 `balance` 在指定日期零点生效，核对月末公户余额时日期填次月首日。

## 记账操作步骤

1. 查阅业务策略：调用 `list_policies` 与 `get_policy` 阅读 `policies/base/` 基线及企业自订制度 Markdown，了解科目与合规要求。
2. 确认科目开立：在 `config/accounts.bean` 确认所用科目已经 `open`。资金账户标记 `cash: TRUE`；经营收支科目按 `chart-of-accounts.md` 标注现金流分类（`cashflow`）。
3. 归档凭证单据：将取得的票据按 `document-filing.md` 规范存入 `documents/` 对应科目目录。
4. 录入当月分录：在 `data/YYYY/YYYY-MM.bean` 写入分录。新建月份文件时，在 `data/YYYY/YYYY.bean` 中显式 `include` 该月文件。
5. 执行合规核查：调用 `check_ledger`，先执行 `bean-check` 校验语法与金额平衡；若 `policies/` 下配置了机器规则，再按生效区间核验。保存账本后，BeanDesk 桌面界面在 Fava 重新加载时即可查阅更新后的报表；归档凭证若路径与日期匹配（或文件名包含交易 link 标记），可在日记账中穿透预览。

```beancount
2026-03-15 * "XX客户公司" "系统架构咨询服务款" #income #invoice
  Assets:Bank-银行存款:Main-基本户                    50000.00 CNY
  Income:Service-主营业务收入:Consulting-架构咨询服务 -50000.00 CNY
```
