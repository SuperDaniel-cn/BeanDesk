---
name: fava-beancount-guide
description: 引导用户在其指定的工作目录自建 Beancount 账本，再用一个 Fava 对接本前端。本仓库不附带账本，也不记录任何账本路径、科目、分录或凭证。适用于确认目录、第一本账骨架、开立科目、记分录、bean-check、启动一个 Fava。不要假设已经存在某个账本仓库，不要把 BeanDesk 做成换仓库。
---

# Fava 与 Beancount 账本使用与记账指南

本指南是无状态的操作说明。本仓库只包含壳，不包含账本，也不知道用户的文件在哪。

每次执行前先向用户确认工作目录：

- 用户已有账本：只读写该目录。科目以该目录 `config/accounts.bean` 里已经 `open` 的名字为准。
- 用户还没有账本：按下面的骨架在用户指定的空目录写下第一本账。
- 不要搜索、克隆或假设名为某个固定仓库的账本。不要调用账本目录里未必存在的 `make` 目标。
- 一本账一个入口文件。多本账是同一个 Fava 进程带上多个根文件（`fava a.bean b.bean`），用 slug 切换。不要换 BeanDesk“仓库”，也不要再拉第二个服务。

## 1. 前端与用户账本

```
┌────────────────────────────────────────┐
│ 前端 BeanDesk                          │
│ 端口: 5188                             │
└───────────────────▲────────────────────┘
                    │ /api/fava 代理转发
┌───────────────────▼────────────────────┐
│ 用户自己的账本目录（不在本仓库内）        │
│ Fava 端口: 5000                        │
│ - main.bean / data/ / documents/       │
└────────────────────────────────────────┘
```

### 启动

桌面可以在启动命令留空时用安装包里的引擎拉起这一个 Fava。自己启动时，在用户的工作目录执行，只监听本机：

   ```bash
   fava --host 127.0.0.1 --port 5000 main.bean
   ```

   确认 http://127.0.0.1:5000 可访问。不要把 `--host` 设成 `0.0.0.0`。同一进程要挂第二本账时，把第二个根文件加进这一条命令，不要另开端口。

2. 在前端仓库的 `web/` 目录启动界面：

   ```bash
   bun install
   bun run dev
   ```

   开发服务器在 5188 端口，把 `/api/fava` 代理到 5000。浏览器打开 http://localhost:5188。

### 新建账本

用户还没有账本时，在用户指定的空目录建立：

```
<用户指定的账本目录>/
├── main.bean
├── .gitignore
├── config/
│   └── accounts.bean
├── data/
│   └── YYYY/
│       ├── YYYY.bean
│       └── YYYY-MM.bean
└── documents/
```

`main.bean` 显式 `include` 配置和年度索引。年度索引 `data/YYYY/YYYY.bean` 显式 `include` 每个 `YYYY-MM.bean`。漏掉 `include` 时，入口文件不会读到该月。

`config/accounts.bean` 先 `open` 科目，再写分录。下面的名字只是空账本示例，不对应任何现有账本。复制前由用户确认。已有账本不要用这套名字覆盖已经开立的科目。

```
2020-01-01 open Assets:Bank:Checking CNY
2020-01-01 open Liabilities:Owner:Advance CNY
2020-01-01 open Equity:Capital CNY
2020-01-01 open Income:Services:Delivery CNY
2020-01-01 open Income:Services:Advice CNY
2020-01-01 open Expenses:Operations:Hosting CNY
```

经营收入可以按业务拆开，例如交付和顾问各一个收入科目。名字以用户账本里 `open` 的为准。

需要别的科目时，先在 `config/accounts.bean` 里 `open`，再引用。不要写未声明的科目。

## 2. 上游版本与排错

本前端适配的上游版本：

- Python: 3.10 或更高
- beancount: 大于等于 3.2.0
- fava: 大于等于 1.30.0 且小于 2.0.0

```text
beancount>=3.2.0
fava>=1.30.0,<2.0.0
```

不要为了迁就旧文档把 Beancount 降到 2.x。Fava 1.30 对接的是 Beancount 3。

Fava 的 ledger_data 不返回自身版本号。前端用字段是否存在来适配，不在代码里写死 Fava 版本。

### 常见排错

问题一：5000 端口被占用。
macOS 隔空播放接收默认占用 5000。关闭该功能，或换端口：`fava --host 127.0.0.1 -p 5001 main.bean`，启动前端时加 `FAVA_URL=http://127.0.0.1:5001`。

问题二：前端报错，或 `/api/fava` 返回 404、500。
1. 确认 Fava 在 `127.0.0.1` 上，且没有改成 `0.0.0.0`。
2. 在用户的账本目录执行 `bean-check main.bean`。
3. 确认 Vite 把 `/api/fava` 转到 `FAVA_URL`（默认 http://127.0.0.1:5000）。
4. 账套 slug 探测失败时，页面会报错。在 `web/public/config.js` 写入该账本的 `slug`。探测失败后不要继续沿用一个未生效的默认名。

问题三：升级 Fava 大版本。
跨大版本时接口字段可能变化。先在隔离环境对用户自己的账本试跑，通过后再升级。

## 3. 一人公司记账约束

这些是记账时要遵守的规则，不是某一本现成账的科目清单。

### 财产独立
公司账户只记经营收支。股东个人消费不入账。

### 法人借款与股东往来
垫资和借款用负债科目，并与实收资本分开。新账本可采用示例名 `Liabilities:Owner:Advance` 和 `Equity:Capital`。

还款摘要注明“还股东借款”或“还垫付款”。已有账本沿用它已经 `open` 的对应科目。股东不得无业务实质占用公户资金。

### 三流一致
每笔对外收付款保持三者一致：合同主体、发票的开具方或购买方、银行对公账户名。

### 币种与标签
结算币种用 `CNY`。标签用小写英文，例如 `#capital`、`#invoice`、`#cloud`。

### 凭证归档
发票和银行回单放在 `documents/`，路径跟随账户名，冒号换成目录分隔：

`documents/<账户路径>/YYYY-MM-DD.<说明>.<扩展名>`

示例（仅当该科目已在用户账本中 `open`）：

`documents/Assets/Bank/Checking/2020-01-15.sample-invoice.pdf`

Fava 按账户路径和日期关联单据，前端在明细里预览。

### 余额断言
`balance` 在指定日期的零点生效。校验月末余额时，日期填次月首日。示例：

```
2020-02-01 balance Assets:Bank:Checking 0.00 CNY
```

账户名换成用户账本里实际 `open` 的银行科目。

## 4. 记一笔账

查账用 BeanDesk MCP 的只读 Fava 工具（`get_ledger`、`run_bql`、报表、`get_journal`）。不要猜仓库名。改账仍写工作目录，不要走 Fava 的写入接口。

1. 向用户确认账本目录。没有就先按第 1 节新建。可用 MCP `get_connection`。
2. 读取该目录的 `config/accounts.bean`。提取日期、payee、narration、金额、税号和收付款账户，核对三流一致。
3. 把发票或回单放进 `documents/` 下对应科目目录。
4. 分录写入 `data/YYYY/YYYY-MM.bean`，并在 `data/YYYY/YYYY.bean` 中 `include`。只使用已经 `open` 的科目。支出同时记费用，以及资产减少或负债增加。
5. 在该账本目录执行 `bean-check main.bean`，或用 MCP `check_ledger`。
6. 用 MCP 报表工具或打开界面，核对本期余额和单据目录。
