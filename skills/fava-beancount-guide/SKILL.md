---
name: fava-beancount-guide
description: 引导用户在其指定的工作目录管理 Beancount 企业账套，直连 Fava 服务。支持标准账套初始化、开立科目、日常分录编写、凭证穿透归档、bean-check 检查与 check_ledger 策略核查。本仓库不附带账套，也不记录任何账套路径、科目、分录或凭证。
---

# Fava 与 Beancount 企业账套操作指南

本技能指导企业账套的建立、日常分录录入、凭证归档与合规核查。BeanDesk 仓库仅提供前端与桌面端界面，不托管账套数据，也不记录任何账套路径。客户安装包不含本技能；过账规范以工作目录 `policies/base/` 为准。

## 执行前置原则

1. 确认账套目录：仅读写用户明确指定的账套目录。已有账套以 config/accounts.bean 内已开立的科目为准；新账套可在指定空目录按标准账套结构建立。空目录优先在 BeanDesk 设置中点击“初始化企业账套”（弹出会计准则与记账币种，默认 zh-CN / CNY），或通过 MCP init_ledger（必须确认写入，防止未经确认写入空目录）。对空目录点“连接”也会打开同一弹窗，不会静默写结构。桌面与 MCP 都必须显式传 locale：zh-CN 或 en，不能省略；币种随会计准则带入。已有 main.bean 但没有 .beandesk 时，用设置页“接管为标准账套”或 MCP upgrade_ledger（同样必须确认写入并显式传 locale）；旧版 .beandesk 用“升级账套结构”。桌面升级/接管使用同一弹窗。两者都只补缺失的 policies/base，不改 data/ 分录。
2. 服务连接与运行边界：优先使用 BeanDesk 桌面端内置引擎连接账套。MCP 直接读取设置中保存的账套目录与 Fava 地址，不会在后台自动拉起未运行的 Fava 服务；服务未通时工具会返回未就绪。无需为记账去启动本仓库的前端开发服务器（make dev）。若自行启动 Fava，在用户账套目录下执行（如 fava --host 127.0.0.1 -p 5000 main.bean）。
3. 架构模式：采用主控路由与按需参考。执行具体任务时，根据需要查阅 references/ 下的专项目录（科目连字符命名规范 references/naming-convention.md、凭证归档规范 references/document-filing.md、合规规则编写 references/policy-rules.md、排错指南 references/troubleshooting.md）。在已初始化的账套中，以账套内 policies/base/ 为准（list_policies / get_policy）。
4. 单一服务接入：桌面端直连单个 Fava 服务。多账套通过同一个 Fava 进程指定多个入口文件（如 fava a.bean b.bean）并通过 slug 切换，无需另起第二个服务。

## 标准账套结构

```
<用户账套目录>/
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

- .beandesk：版本化标记（version 与 locale），标识为 BeanDesk 标准账套，用于启用快照与加密备份。
- .gitignore：忽略 .backup_key、.env 与 backups/。
- config/commodities.bean：定义记账币种（zh-CN 预设默认 CNY，en 预设默认 USD）。
- config/accounts.bean：初始化只开立最小通用账户；经营科目按 policies/base/chart-of-accounts.md 按需 open，并配置 cash 与 cashflow 元数据。
- policies/：业务指引为 Markdown，机器规则为 TOML。初始化写入 base/。
- main.bean：主入口文件，必须声明凭证目录并按顺序引入配置与年度索引。

## 记账标准操作流程（SOP）

1. 确认账套目录：通过 MCP get_connection 核对当前生效的账套目录。
2. 读取业务策略：调用 list_policies 与 get_policy，先读 base/ 下的科目、归档与记账说明，再读企业自订 Markdown。
3. 提取凭据信息并拟定科目：确认日期、往来单位（payee）、业务摘要（narration）、金额与收付款账户；票面有法定或合同唯一编号则抄录完整号码，没有则留空，严禁自造编号。只读 `config/accounts.bean` 判断科目是否已 `open`，此步不写盘。
4. 入账前查重与汇总确认：按下一节完成双轨检索，把本批票据的要素、查重结果、拟新增科目与拟写入分录做成一张清单，交给用户确认。未确认严禁写入 `config/accounts.bean`、`documents/` 与 `data/`。
5. 用户确认后再写盘：按 base/chart-of-accounts.md 开立缺失科目；按 base/document-filing.md 将凭证存入 documents/ 对应科目文件夹；在当月 data/YYYY/YYYY-MM.bean 录入分录，并在 data/YYYY/YYYY.bean 中显式 include 该月文件。有完整票号的分录标注 `^inv-<完整号码>` 或 `^ct-<完整合同号>`。
6. 语法与规则核查：
   - 命令行运行 bean-check main.bean 验证底层语法与金额平衡（合计归零）。
   - 通过 MCP 调用 check_ledger：先执行 bean-check；机器规则来自随包装会计准则与桌面上次审核批准的自定义 TOML，不信任磁盘上未批准的文件。未播种时调用 upgrade_ledger（显式 locale 与 confirmWrite）播种；自定义规则仍须在 BeanDesk 桌面端审核批准。error 报错拦截，warning 仅提示。`ok` 只表示语法、平衡与已有机器规则匹配，不表示没有重复入账。
7. 报表与关联确认：在 BeanDesk 中查看报表，核对凭证已建立穿透预览。

## 入账前查重与确认

这是助手写盘前的操作纪律，不是 BeanDesk 界面或 `check_ledger` 的自动拦截。MCP 不写入记账分录。

- 有码用全号：增值税发票、数电票、合同等票面编号写入 `^inv-<完整号码>` 或 `^ct-<完整合同号>`，号码不得截成后几位。归档文件名应在日期之后加入 `.inv-<完整号码>` 或 `.ct-<完整合同号>`，见 references/document-filing.md。
- 无码不强造：转账截图、无号收据、银行回单，以及折旧、结息、期初、工资发放表等无外部凭证的分录，严禁编造 `^inv-` / `^rcpt-` 序号。银行流水号即使很长也不当作业务键。
- 检索主路径：必须搜索账套内已有的 `data/` 与 `documents/`。Fava 已通时可加做 `run_bql`；服务未就绪不得中断入账。
- 编号匹配：有号码则搜完整 link 与文件名中的全号。可用号码后 8 位列出候选；后缀命中不得自动判重，也不得把短码写成 `^link`。
- 业务指纹：无法定编号或编号匹配未命中时，只比前后 7 天内、金额完全相等、且同一往来单位或同一收入/费用科目的已入账分录。结转、折旧、结息、期初、工资发放表等无外部凭证的分录不做指纹查重。
- 单批合一：单张或多张票据都放进同一张确认清单。查重命中时写明重叠分录的日期、摘要与金额，由用户选择：同一业务重复投递（该发票已入账且已归档则完全跳过；若之前只按银行回单入账、本次才补交发票原件，则不新增分录，仅归档发票文件，并在原分录补挂 `^inv-<完整号码>`）；分期收付款或往来挂账核销（关联同一 `^inv-…` 后继续入账）；恰好同金额的独立新业务（正常入账）。用当前对话列出选项并等待回复；宿主若另有提问控件也可使用，不要绑定某一个工具名。
