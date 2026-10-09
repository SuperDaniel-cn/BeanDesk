---
name: fava-beancount-guide
description: 引导用户在其指定的工作目录管理 Beancount 企业账本，直连 Fava 服务。支持标准账本初始化、开立科目、日常分录编写、凭证穿透归档、bean-check 检查与 check_ledger 策略核查。本仓库不附带账本，也不记录任何账本路径、科目、分录或凭证。
---

# Fava 与 Beancount 企业账本操作指南

本技能指导企业账本的建立、日常分录录入、凭证归档与合规核查。BeanDesk 仓库仅提供前端与桌面端界面，不托管账本数据，也不记录任何账本路径。客户安装包不含本技能；过账规范以工作目录 `policies/base/` 为准。

## 执行前置原则

1. 确认工作目录：仅读写用户明确指定的账本目录。已有账本以 config/accounts.bean 内已开立的科目为准；新账本可在指定空目录按标准骨架建立。空目录优先在 BeanDesk 设置中点击“初始化账本”（弹出语言包与记账币种，默认 zh-CN / CNY），或通过 MCP init_ledger（必须确认写入，防止未经确认写入空目录）。对空目录点“连接”也会打开同一弹窗，不会静默写骨架。桌面与 MCP 都必须显式传 locale：zh-CN 或 en，不能省略；币种随语言包带入。已有 main.bean 但没有 .beandesk 时，用设置页“接管为标准账本”或 MCP upgrade_ledger（同样必须确认写入并显式传 locale）；旧版 .beandesk 用“升级账本骨架”。桌面升级/接管使用同一弹窗。两者都只补缺失的 policies/base，不改 data/ 分录。
2. 服务连接与运行边界：优先使用 BeanDesk 桌面端内置引擎连接账本。MCP 直接读取设置中保存的工作目录与 Fava 地址，不会在后台自动拉起未运行的 Fava 服务；服务未通时工具会返回未就绪。无需为记账去启动本仓库的前端开发服务器（make dev）。若自行启动 Fava，在用户账本目录下执行（如 fava --host 127.0.0.1 -p 5000 main.bean）。
3. 架构模式：采用主控路由与按需参考。执行具体任务时，根据需要查阅 references/ 下的专项目录（科目连字符命名规范 references/naming-convention.md、凭证归档规范 references/document-filing.md、合规规则编写 references/policy-rules.md、排错指南 references/troubleshooting.md）。在已初始化的账本中，以工作目录 policies/base/ 为准（list_policies / get_policy）。
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
    ├── README.md
    └── base/
        ├── chart-of-accounts.md
        ├── document-filing.md
        ├── bookkeeping-guide.md
        └── rules.toml      # zh-CN 预设写入；en 预设不写机器规则
```

- .beandesk：版本化标记（version 与 locale），标识为 BeanDesk 标准账本，用于启用快照与加密备份。
- .gitignore：忽略 .backup_key、.env 与 backups/。
- config/commodities.bean：定义记账币种（zh-CN 预设默认 CNY，en 预设默认 USD）。
- config/accounts.bean：初始化只开立最小通用账户；经营科目按 policies/base/chart-of-accounts.md 按需 open，并配置 cash 与 cashflow 元数据。
- policies/：业务指引为 Markdown，机器规则为 TOML。初始化写入 base/。
- main.bean：主入口文件，必须声明凭证目录并按顺序引入配置与年度索引。

## 记账标准操作流程（SOP）

1. 确认账本目录：通过 MCP get_connection 核对当前生效的工作目录。
2. 读取业务策略：调用 list_policies 与 get_policy，先读 base/ 下的科目、归档与记账说明，再读企业自订 Markdown。
3. 提取凭据信息：确认日期、交易对手（payee）、摘要（narration）、金额与收付款账户。
4. 归档凭证单据：将票据存入 documents/ 对应科目文件夹，规则见 get_policy 的 base/document-filing.md。
5. 编写交易分录：按 base/chart-of-accounts.md 在当月 data/YYYY/YYYY-MM.bean 中录入分录，并在 data/YYYY/YYYY.bean 中显式 include 该月文件。
6. 语法与规则核查：
   - 命令行运行 bean-check main.bean 验证底层语法与金额平衡（合计归零）。
   - 通过 MCP 调用 check_ledger：先执行 bean-check；若 policies/ 下配置了 TOML 规则，再按生效区间核验（error 报错拦截，warning 仅提示）。
7. 报表与关联确认：在 BeanDesk 中查看报表，核对凭证已建立穿透预览。
