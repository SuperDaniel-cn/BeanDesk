---
name: fava-beancount-guide
description: 引导用户在其指定的工作目录管理 Beancount 企业账本，直连 Fava 服务。支持标准账本初始化、开立科目、日常分录编写、凭证穿透归档、bean-check 检查与 check_ledger 策略核查。本仓库不附带账本，也不记录任何账本路径、科目、分录或凭证。
---

# Fava 与 Beancount 企业账本操作指南

本技能指导企业账本的建立、日常分录录入、凭证归档与合规核查。BeanDesk 仓库仅提供前端与桌面端界面，不托管账本数据，也不记录任何账本路径。

## 执行前置原则

1. 确认工作目录：仅读写用户明确指定的账本目录。已有账本以 config/accounts.bean 内已开立的科目为准；新账本可在指定空目录按标准骨架建立。空目录优先在 BeanDesk 设置中点击“初始化账本”，或通过 MCP init_ledger（必须传入 confirmWrite: true，防止未经确认写入空目录）。
2. 服务连接与运行边界：优先使用 BeanDesk 桌面端内置引擎连接账本。MCP 直接读取设置中保存的工作目录与 Fava 地址，不会在后台自动拉起未运行的 Fava 服务；服务未通时工具会返回未就绪。无需为记账去启动本仓库的前端开发服务器（make dev）。若自行启动 Fava，在用户账本目录下执行（如 fava --host 127.0.0.1 -p 5000 main.bean）。
3. 架构模式：采用主控路由与按需参考。执行具体任务时，根据需要查阅 references/ 下的专项目录：
   - 科目连字符命名规范：references/naming-convention.md
   - 小微企业标准科目字典：references/accounts-template.bean
   - 凭证归档与穿透索引规则：references/document-filing.md
   - TOML 自动化合规规则编写：references/policy-rules.md
   - 端口占用与常见排错：references/troubleshooting.md
4. 单一服务接入：桌面端直连单个 Fava 服务。多套账本通过同一个 Fava 进程指定多个入口文件（如 fava a.bean b.bean）并通过 slug 切换，无需另起第二个服务。

## 标准账本骨架

```
<用户工作目录>/
├── .beandesk
├── .gitignore
├── main.bean
├── config/
│   ├── commodities.bean
│   └── accounts.bean
├── data/
│   └── YYYY/
│       ├── YYYY.bean
│       └── YYYY-MM.bean
├── documents/
└── policies/
    └── README.md
```

- .beandesk：标识为 BeanDesk 标准账本，用于启用快照与加密备份。
- .gitignore：忽略 .backup_key、.env 与 backups/。
- config/commodities.bean：定义记账币种（初始化默认写入 CNY 与 USD）。
- config/accounts.bean：使用连字符中文格式声明科目并配置 cash 与 cashflow 元数据。
- policies/：可选的记账合规策略目录。业务指引写为 Markdown，机器规则写为 TOML。
- main.bean：主入口文件，必须声明凭证目录并按顺序引入配置与年度索引：

```beancount
option "title" "Ledger"
option "operating_currency" "CNY"
option "documents" "documents"
include "config/commodities.bean"
include "config/accounts.bean"
include "data/YYYY/YYYY.bean"
```

## 日常经营记账原则

- 财产独立：公司账户核算对公经营收支，个人及家庭消费独立核算。
- 垫资与出资分离：法人临时垫资记入负债（如 Liabilities:Owner-股东往来:Advance-法人垫资借款），股东出资记入权益（Equity:Capital-实收资本:PaidIn-股东出资）。
- 三流一致：业务合同主体、发票抬头与银行账户名称保持一致。
- 月末余额断言：Beancount 的 balance 断言在当天 00:00 生效，月末公户对账断言日期填写次月首日。

## 记账标准操作流程（SOP）

1. 确认账本目录：通过 MCP get_connection 核对当前生效的工作目录。
2. 读取业务策略：若工作目录包含 policies/，调用 list_policies 与 get_policy 查阅相关指引。
3. 提取凭据信息：确认日期、交易对手（payee）、摘要（narration）、金额与收付款账户。
4. 归档凭证单据：将票据存入 documents/ 对应科目文件夹，文件名前缀日期与交易日期一致（规则参考 references/document-filing.md）。
5. 编写交易分录：按连字符规范（参考 references/naming-convention.md）在当月 data/YYYY/YYYY-MM.bean 中录入分录，并在 data/YYYY/YYYY.bean 中显式 include 该月文件（否则分录不会被 main.bean 汇总读取）。
6. 语法与规则核查：
   - 命令行运行 bean-check main.bean 验证底层语法与金额平衡（合计归零）。
   - 通过 MCP 调用 check_ledger：先执行 bean-check 语法与平衡检查；若 policies/ 目录下配置了 TOML 规则，还会根据生效区间核验分录规范（error 报错拦截，warning 仅提示）。
7. 报表与关联确认：在 BeanDesk 中查看报表数据，核对凭证已成功建立穿透预览。

分录示范：

```beancount
2026-02-10 * "XX云网络技术有限公司" "采购年度云服务器及带宽" #cloud #invoice
  Expenses:Operations-主营业务成本:Cloud-云计算与算力      1200.00 CNY
  Assets:Bank-银行存款:Main-XX银行对公户                 -1200.00 CNY
```
