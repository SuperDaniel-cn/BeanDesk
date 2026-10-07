# BeanDesk · 经营账本

> 一人公司对公财税与合规工作台

BeanDesk 是一款面向一人有限责任公司（OPC）、独立创作者、小微团队及企业管理者的本地优先（Local-first）复式记账财务工作台与桌面客户端。基于 Beancount 与 Fava 构建，无需云端账户，无中心化数据库，兼顾企业对公收支合规、三流一致证据链与内部经营管理账。

Fava 作为底层通用会计与数据查询引擎，BeanDesk 作为独立的展现与工作台层，直接与本地或私网中的 Fava 服务通信，零定制后端，数据完全自持。

[English](README.md) | **简体中文**

[![Release](https://img.shields.io/github/v/release/SuperDaniel-cn/BeanDesk?color=blue)](https://github.com/SuperDaniel-cn/BeanDesk/releases)
[![License](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![赞助](https://img.shields.io/badge/Sponsor-Payoneer%20%7C%20加密货币-ea4aaa?logo=githubsponsors&logoColor=white)](#赞助支持)

![经营账本试算平衡表预览](./docs/images/zh/trial-balance.png)

## 核心特性

### 试算平衡表（Trial Balance）
首屏直达。借贷双栏并排呈现经典科目余额表，汇总全账目余额，实时校验借贷双方合计是否平衡。支持全科目层级折叠展开、关键字快速过滤，并可直接点击科目穿透至交易明细账。若借贷不平，直观高亮差额。

![试算平衡表](./docs/images/zh/trial-balance.png)

### 法定财务三张表

#### 资产负债表
双栏平衡排版，完整呈现闭合后的账户树结构。本期损益自动结转至所有者权益，自动剔除换汇占位差额。

![资产负债表](./docs/images/zh/balance-sheet.png)

#### 利润表
多步式分层展示主营业务收入、运营支出、税费与净利润，清晰反映经营成果。

![利润表](./docs/images/zh/income-statement.png)

#### 现金流量表（直接法）
前端纯函数实时计算。依据账本科目 `open` 指令的元数据动态映射：`cash` 标示货币资金，`cashflow` 标示法定活动行次；支持通过 `cashflow-in` 与 `cashflow-out` 分别指定流入与流出。零余额项目自动隐藏，纯计提等非现金分录自动剔除。

![现金流量表](./docs/images/zh/cash-flow.png)

### 全局时间切片
顶栏导航支持按全部时期、年度、季度或月份一键切换，选中周期自动同步至各财务报表、明细账及 BQL 查询控制台。

### 交易明细账与凭证穿透
桌面端呈现紧凑表格，移动端自适应为卡片流。支持按收款方、摘要、科目类型及标签多维检索。点击任意交易即可弹出借贷分录明细；桌面端通过原生安全通道直接加载并预览关联的电子发票或银行回单等原始凭证。

![交易明细账与凭证穿透](./docs/images/zh/journal.png)

### 原生 BQL 查询控制台
内置常用财务查询模板，支持快捷键执行、结果排序与导出 CSV。数值列自动右对齐展示，方便深度分析。

![BQL 查询控制台](./docs/images/zh/query.png)

### 开箱即用的跨平台桌面端（Tauri 2）
- **内置冻结引擎（Sidecar）**：安装包附带完整运行环境，开箱即用，无需预装 Python 或配置虚拟环境。
- **智能生命周期监管**：启动前自动探测端口；已在运行则快速连接，未启动则拉起独立进程组运行，窗口退出时干净终止。
- **第一本账骨架初始化**：支持在空白工作目录下一键生成标准化会计科目骨架（`main.bean`）、记账策略目录（`policies/`）与初始配置。
- **盘上变动无感同步**：静默监听底层 Fava 状态，外部编辑器或 AI 写入分录后 4 秒内自动刷新报表，无需手动重载页面。
- **双重本地备份**：
  - **Git 自动快照**：基于防抖监听，实时捕获账本与策略规则变动并生成本地版本快照（原始凭证仅通过 restic 归档，不入 Git）。
  - **restic 强加密归档**：按需或自动增量备份至多个本地目录或 S3 兼容对象存储（Cloudflare R2、MinIO、AWS S3），密钥通过隔离凭证或环境变量传入，不在进程参数中暴露明文。

![桌面设置与备份管理](./docs/images/zh/settings.png)

### 税期日历与到期提醒
支持配置本地 `.ics` 文件或标准 HTTPS iCal 订阅源（如 Google Calendar 或 Outlook 公开链接）。到期前 7 天内的事项在桌面客户端运行期间自动弹出系统通知与应用内横幅，避免错过申报或付款节点。

### 本地 MCP 服务（Model Context Protocol）
桌面可执行程序附加 `mcp` 参数即可作为 stdio MCP 服务运行。设置页面提供一键复制配置，可直接接入 Cursor、Claude Desktop 等 AI 助手。支持只读执行 BQL 查询、读取财务三张表、检索日记账与凭证目录、读取业务指引（`list_policies` / `get_policy`）及初始化骨架。`check_ledger` 统一提供校验门禁：先执行底层语法与金额平衡校验；若 `policies/` 目录下存在 TOML 规则，还会对生效区间内的分录执行自动化规则核验（`error` 报错拦截，`warning` 仅提示）。

### 内置离线用户手册
桌面端内置独立手册窗口，开箱附带完整离线 Fumadocs 指南，无需依赖外网连接即可随时查阅复式记账规范与工作台使用说明。

## 人机协同记账工作流

结合本地 MCP 与桌面端特性，形成 5 步日常记账闭环：

1. **安装桌面端**：免装 Python，无需配置数据库，开箱即用。
2. **初始化账本**：选定空工作目录，一键生成科目表、凭证目录与策略骨架（`policies/`）。
3. **连接 AI 助手**：在桌面设置页复制 stdio MCP 配置，填入 Cursor、Claude Desktop 等能操作本地目录的 AI 工具。
4. **日常随手记账**：把电子发票或银行回单交给 AI 助手。助手识别单据并重命名归档至 `documents/`、编写当月 `.bean` 复式分录，调用 `check_ledger` 校验语法平衡与政策规则。
5. **桌面即时复核**：账本写入后桌面端 4 秒内静默刷新出数；在日记账中点击分录，弹窗直接穿透预览原始单据。

## 设计原则与产品边界

- **数据绝对自持**：账本纯文本与原始凭证完全保留在用户本地工作目录，应用不设云端账本托管，不收集任何财务数据。
- **轻量单实例架构**：直连单一 Fava 服务，多套账目通过 Fava 多根文件与 URL slug 管理，不引入沉重的多租户切换。
- **只读呈现与合规穿透**：定位为财务只读工作台与凭证证据链浏览器。分录的编写与修改由用户通过专业文本编辑器或本地 AI 技能完成，保持纯文本账本的纯粹性。
- **严谨财务表格**：遵循专业财务规范，所有报表均采用高信息密度的结构化表格呈现，不堆砌装饰性图表。

## 快速上手

### 方式一：下载桌面安装包（推荐）

前往 [Releases](https://github.com/SuperDaniel-cn/BeanDesk/releases) 页面，下载适配当前操作系统的安装包：

- **macOS**：提供 Apple Silicon（`.dmg`）与 Intel（`.dmg`）版本。
- **Windows**：提供 64 位安装程序（`.exe`）。
- **Linux**：提供 x86_64 与 ARM64 的 `.deb` / `.AppImage`。

安装后打开设置：
1. **新建账本**：选择一个空白工作目录，点击“初始化账本”，生成标准 `main.bean` 骨架。
2. **已有账本**：选择工作目录，启动命令保持为空（使用内置引擎）或填写自定义启动命令（如 `fava main.bean`）。
3. **连接已有服务**：若局域网或本机已有 Fava 运行，直接填入服务地址直连。

### 方式二：从源码运行

要求：Node 运行时使用 **Bun 1.1+**，桌面端开发需安装 **Rust** 工具链。

```bash
# 1. 克隆仓库并安装前端依赖
git clone https://github.com/SuperDaniel-cn/BeanDesk.git
cd BeanDesk
make install

# 2. 启动桌面端（推荐）
make desktop

# 或仅启动 Web 浏览器端（默认端口 5188，代理转发至 5000 端口 Fava）
make dev

# 3. 运行完整测试（Lint、类型检查、前端与 Rust 测试）
make test
```

## 架构

```
┌────────────────────────────────────────┐
│               浏览器界面               │
└───────────────────▲────────────────────┘
                    │ http://127.0.0.1:5188 (/api/fava)
┌───────────────────▼────────────────────┐
│         BeanDesk Web (Vite / Caddy)    │
└───────────────────▲────────────────────┘
                    │ 剥离 /api/fava 前缀
                    │
┌───────────────────▼────────────────────┐       Tauri 原生 HTTP 插件
│               Fava 引擎                │ ◄────────────────────── ┌────────────────────────────────────────┐
│         http://127.0.0.1:5000          │                         │           BeanDesk 桌面端 (Tauri 2)    │
└───────────────────▲────────────────────┘                         │    - 本地设置与服务直连               │
                    │                                              │    - 内置引擎看管与生命周期托管        │
┌───────────────────┴────────────────────┐                         │    - 本地 Git 快照与 restic 加密备份   │
│         用户纯文本账本 (.bean)          │                         │    - 本地 stdio MCP 服务与离线手册     │
└────────────────────────────────────────┘                         └────────────────────────────────────────┘
```

## 部署与安全规范

Fava 接口支持执行任意 BQL 查询与读取凭证文件，严禁将 Fava 端口直接暴露在公网 IP。

推荐安全部署方式：
1. **本地回环绑定**：将 Fava 与前端服务严格绑定在 `127.0.0.1`。
2. **远程访问方案**：
   - **私有虚拟网络**：通过 Tailscale 或 WireGuard 组网，仅限受信任设备访问。
   - **零信任隧道**：使用 Cloudflare Tunnel，并在公网域名外层配置 Cloudflare Access 身份验证（如邮箱一次性验证码）。

详细反向代理配置与部署操作参见 [DEPLOY.md](DEPLOY.md)。

## 目录结构

```
BeanDesk/
├── AGENTS.md               # 工程规范与开发契约
├── DEPLOY.md               # 本机绑定、Caddy 反代与隧道部署指南
├── docs/                   # 用户手册源码（Fumadocs）与界面截屏
│   ├── content/docs/       # 手册中英文 Markdown 内容
│   └── images/             # 界面截屏（zh / en）
├── skills/                 # AI 智能体记账引导技能
│   └── fava-beancount-guide/ # 复式记账指引与合规分录规范
├── src-tauri/              # Tauri 2 桌面端（Rust）
├── web/                    # 前端项目（React 19, TypeScript, Tailwind CSS, shadcn/ui）
│   ├── src/pages/          # 页面：试算平衡、资产负债表、利润表、现金流量表、明细账、BQL 查询、日历、设置
│   ├── src/lib/            # 现金流纯函数计算、数据适配层、接口客户端
│   └── src/i18n/           # 中英文国际化语言包
├── Makefile                # 常用自动化指令
├── README.md               # 英文说明
└── README.zh-CN.md         # 简体中文说明
```

## 赞助支持

BeanDesk 完全开源且免费。如果它为你节省了时间或提供了帮助，欢迎赞助支持项目的持续维护与更新：

- **Payoneer（信用卡 / 借记卡 / 外币）**：[通过 Payoneer 赞助](https://link.payoneer.com/Token?t=D6ADDF769F5F4EE7B8F8F188A32AE50C&src=pl)
- **USDC（Solana 链）**：`CiZxojzWpKwXqxqbQQ8gN6Qb4pdGSuKzYA9MbX8ukFKK`
- **USDC（Base / Arbitrum / Ethereum）**：`0x43ad55b5fe79d1d8afee3425a6011cfb9a512927`

## 许可证

本项目采用 [GNU Affero General Public License v3.0 (AGPL-3.0)](./LICENSE) 协议开源。
