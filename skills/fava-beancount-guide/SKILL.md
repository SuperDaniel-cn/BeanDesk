---
name: fava-beancount-guide
description: 引导用户在其指定的工作目录自建 Beancount 账本，再用一个 Fava 对接本前端。本仓库不附带账本，也不记录任何账本路径、科目、分录或凭证。适用于确认目录、第一本账骨架、开立科目、记分录、bean-check、启动一个 Fava。不要假设已经存在某个账本仓库，不要把 BeanDesk 做成换仓库。
---

# Fava 与 Beancount 企业经营账本记账指南

本指南是无状态的操作说明，用于指导企业经营账本的建立、日常分录编写与凭证归档。本仓库只包含前端界面，不托管账本数据。

每次执行前先向用户确认工作目录：

- 用户已有账本：只读写该目录。科目以该目录 `config/accounts.bean` 里已经 `open` 的名字为准。
- 用户还没有账本：按下面的骨架在用户指定的空目录建立账本。空目录优先在 BeanDesk 设置中点击“初始化账本”，或通过 MCP `init_ledger`（需传入 `confirmWrite: true`）。
- 一本账一个入口文件。多本账是同一个 Fava 进程带上多个根文件（`fava a.bean b.bean`），通过 slug 切换，不要另起第二个服务。

## 1. 工作目录与账本骨架

优先使用 BeanDesk 桌面端内置引擎连接账本。MCP 直接读取设置中保存的工作目录与 Fava 连接地址（不会在后台自动拉起未运行的服务；服务未通时工具会返回未就绪）。不要为记账去启动本仓库的前端开发服务器。

若自行启动 Fava，在用户账本工作目录下执行，仅监听本机：

```bash
fava --host 127.0.0.1 --port 5000 main.bean
```

### 标准账本目录结构

```
<用户指定的账本目录>/
├── .beandesk
├── .gitignore
├── main.bean
├── config/
│   └── accounts.bean
├── data/
│   └── YYYY/
│       ├── YYYY.bean
│       └── YYYY-MM.bean
├── documents/
└── policies/
    └── README.md
```

- `.beandesk`：标识为 BeanDesk 标准账本。缺少该标记时，桌面端备份与快照功能保持停用。
- `.gitignore`：必须忽略 `.backup_key`、`.env` 与 `backups/`。
- `policies/`：可选。没有此目录不影响记账。有则过账前先用 MCP `list_policies` / `get_policy` 读取其中的 Markdown。`check_ledger` 只检查语法与平衡，不检查这些规则是否已执行。
- `main.bean`：主入口文件，必须声明 `option "documents" "documents"` 以启用凭证自动扫描：

```beancount
option "title" "Ledger"
option "operating_currency" "CNY"
option "documents" "documents"
include "config/accounts.bean"
include "data/YYYY/YYYY.bean"
```

### 科目定义与现金流标记

在 `config/accounts.bean` 中开立科目。货币资金科目添加 `cash: TRUE`；收支与资产科目添加现金流分类元数据（`cashflow: "..."`），合法行次参见用户手册报表页：

```beancount
2020-01-01 open Assets:Bank:Checking CNY
  cash: TRUE
2020-01-01 open Liabilities:Owner:Advance CNY
  cashflow-in: "borrowings"
  cashflow-out: "debt-principal"
2020-01-01 open Equity:Capital CNY
  cashflow: "capital"
2020-01-01 open Income:Services:Delivery CNY
  cashflow: "sales"
2020-01-01 open Income:Services:Advice CNY
  cashflow: "sales"
2020-01-01 open Expenses:Operations:Hosting CNY
  cashflow: "operating-other-out"
```

需要新科目时，先在 `config/accounts.bean` 中 `open` 再引用。已有账本若现金流量表空白，给对应的 `open` 补充元数据即可，切勿重新初始化覆盖。

## 2. 企业日常经营记账原则

- **财产独立**：公司账户仅核算对公经营收支，股东个人与家庭消费不入账。
- **垫资借款与资本分开**：股东或法人向公司临时借款垫资，统一记入负债科目（如 `Liabilities:Owner:Advance`），与实收资本（`Equity:Capital`）分开核算；公司还款时摘要注明“还股东借款”或“还垫付款”。
- **三流一致**：对外收付款项时，业务合同主体、发票开具或购买方抬头、银行对公账户名三者保持一致。
- **凭证规范归档**：原始发票与银行电子回单存入 `documents/` 目录下对应科目路径，冒号转换为目录斜杠：
  `documents/<科目路径>/YYYY-MM-DD.<说明>.<ext>`
  示例：`documents/Assets/Bank/Checking/2026-01-15.bank-receipt.pdf`
- **月末余额对账**：Beancount 的 `balance` 断言在当天 00:00 生效。校验月末公户余额时，断言日期填次月首日：
  `2026-02-01 balance Assets:Bank:Checking 50000.00 CNY`

## 3. 记一笔账（标准操作流程）

查账优先使用 BeanDesk MCP 的只读工具（`get_ledger`、`run_bql`、报表工具、`get_journal`）。修改分录直接编辑工作目录文件，不要调用 Fava 的写入接口。记账需要能写账本目录的本机 Agent；把单据放进云端对话会把文件送出本机。

1. **确认账本目录**：可通过 MCP `get_connection` 核对当前生效的工作目录。
2. **读取额外策略**：若工作目录有 `policies/`，先 `list_policies` 再 `get_policy`，按其中 Markdown 过账。没有该目录则跳过。
3. **提取凭据信息**：核对日期、对方单位（payee）、摘要（narration）、金额与收付款账户，确保三流一致。
4. **归档凭证单据**：将发票或银行回单放入 `documents/` 下对应科目的子目录，文件名日期与交易对齐。
5. **编写交易分录**：将分录录入当月文件 `data/YYYY/YYYY-MM.bean`，并在 `data/YYYY/YYYY.bean` 中显式 `include`。只使用已 `open` 的科目。
6. **语法与平衡校验**：在账本目录下运行 `bean-check main.bean`，或通过 MCP 调用 `check_ledger`。这只检查语法与平衡，不代替上一步的策略。
7. **报表与凭证穿透确认**：在 BeanDesk 界面或通过 MCP 查看财务报表与日记账，核对单据已正常建立预览关联。

## 4. 上游版本与排错

适配的上游版本：
- Python: 3.10 或更高
- beancount: `>=3.2.0`
- fava: `>=1.30.0, <2.0.0`

### 常见排错

- **5000 端口冲突**：macOS 隔空播放接收服务默认占用 5000 端口。可关闭隔空播放，或更换端口：`fava --host 127.0.0.1 -p 5001 main.bean`。
- **账本连不上或报未就绪**：
  1. 确认 Fava 服务正在监听 `127.0.0.1`。
  2. 在账本目录下执行 `bean-check main.bean` 检查是否有语法错误。
  3. 通过 MCP `get_connection` 检查 BeanDesk 当前保存的连接设置。
