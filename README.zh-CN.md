# BeanDesk

Beancount 与 Fava 的现代财务工作台，基于 React 19、TypeScript、Tailwind CSS、shadcn/ui 与 Tauri 2 构建。支持浏览器网页运行，也提供跨平台桌面客户端。

架构类似于 Clash 体系中的 MetaCubeXD 或 Aria2 体系中的 AriaNg：Fava 作为底层财务计算引擎，BeanDesk 作为独立的展现与工作台层，直接与本地、局域网或私有网络中的 Fava 服务通信，不设自建后端与数据库。

[English](README.md) | **简体中文**

[![Release](https://img.shields.io/github/v/release/SuperDaniel-cn/BeanDesk?color=blue)](https://github.com/SuperDaniel-cn/BeanDesk/releases)
[![License](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![赞助](https://img.shields.io/badge/Sponsor-加密货币赞助-ea4aaa?logo=githubsponsors&logoColor=white)](#赞助支持)

![BeanDesk 界面预览](./docs/images/zh/trial-balance.png)

## 快速上手

BeanDesk 是壳，围着 **一个** Fava。账本文件在你选的文件夹里。我们不提供云。

### 1. 账本服务

- **桌面、第一本账**：设置里选工作目录。启动命令留空则用安装包里的引擎；目录是空的可以先写下 `main.bean` 骨架。
- **自带服务**：自己安装并启动 Fava（`pip install fava`、项目 `.venv` 或 `make run`），填地址或把启动命令写进设置。
- **交给本地助手**：
  > 复制指令：*「在我指定的文件夹里建一份最小 Beancount 账本，并在 127.0.0.1:5000 启动 Fava。不要假设仓库名字。」*

记账指引见 [Fava 与 Beancount 记账指南](skills/fava-beancount-guide/SKILL.md)。

### 2. 启动 BeanDesk

- **桌面（推荐）**：`make desktop`。本机启动（目录 + 空命令或自定义命令），或连接已有地址。
- **浏览器**：只连已经在跑的 Fava。`make dev`，打开 `http://127.0.0.1:5188`。

## 项目定位与演进路线

本项目为 Beancount 与 Fava 用户提供严肃、现代的财务工作台，并逐步扩展面向一人有限责任公司、小微团队及独立开发者的合规辅助能力。

演进规划：

- 第一阶段：通用财务工作台。完整支持资产负债表、利润表、现金流量表三大法定报表，提供借贷并排呈现的试算平衡表、全局时间切片与原生 BQL 查询控制台。
- 第二阶段：一人公司财务合规模块。增加法人借款与股东往来监控，防范公私财产混同与连带清偿责任；提供增值税与企业所得税预提测算、合同发票与银行回单三流一致校验、交付证据链归档。
- 第三阶段：开箱即用的桌面客户端：安装包带冻结引擎，可写下第一本账骨架，仍然只拉一个 Fava。备份是用户自己复制这个文件夹。

## 功能边界与非目标

我们只做 Fava 外面的壳：

- 不做账本云、用户账号、备份上传。工作目录就是用户的文件。
- 不做应用级换仓库。多本账是同一个 Fava 上的多个根文件和 slug。
- 不自建会计引擎，不内置生 Python。报表问 Fava。用户填写的启动命令原样执行。
- 不做网页账本编辑器。改 `.bean` 用桌面编辑器或技能。
- 不追踪个人证券或投资组合。只看经营账。
- 不引入图表。报表用表格。

## 功能特性

### 试算平衡表
打开应用即进入这一页。以借方与贷方并排呈现的经典科目余额表结构，汇总全账目余额，校验借贷双方合计是否平账。支持科目树层级折叠展开、关键字过滤及点击科目跳转明细账。借贷不平时明确标出差额。

![试算平衡表](./docs/images/zh/trial-balance.png)

### 财务三张表

#### 资产负债表
采用左右双栏排版，渲染 Fava 闭合后的账户树。本期损益并入报表的权益一侧，自动过滤汇率占位差额。

![资产负债表](./docs/images/zh/balance-sheet.png)

#### 利润表
分层展示主营业务收入、运营支出与净利润。

![利润表](./docs/images/zh/income-statement.png)

#### 现金流量表
直接法编制。科目分类通过账本 `open` 指令的元数据动态映射：`cash` 标示货币资金，`cashflow` 标示法定活动行次；支持通过 `cashflow-in` 与 `cashflow-out` 分别指定借贷方向。零余额行自动隐藏，纯计提分录自动剔除。

![现金流量表](./docs/images/zh/cash-flow.png)

### 全局时间切片
顶部导航栏支持按全部时期、按年度、按季度或按月份过滤，选中周期自动同步至各报表、明细账和查询控制台。

### 交易明细账
桌面端为紧凑表格，移动端折叠为卡片流。支持按收款方、摘要、科目类型及标签检索。点击交易弹窗查看借贷分录与关联的电子发票或银行回单。在桌面客户端中通过本地对象通道安全加载凭证。

![交易明细账](./docs/images/zh/journal.png)

### BQL 查询控制台
内置常用查询模板，支持快捷键运行、结果排序与导出 CSV。数值列自动右对齐展示。

![BQL 查询控制台](./docs/images/zh/query.png)

### 交互细节
- 移动端侧边抽屉导航。
- 深色与浅色主题切换。
- 完整中英文双语支持。

## 架构

```
┌────────────────────────────────────────┐
│                 浏览器                  │
└───────────────────▲────────────────────┘
                    │ http://127.0.0.1:5188 (/api/fava)
┌───────────────────▼────────────────────┐
│         BeanDesk Web (Vite / Caddy)    │
└───────────────────▲────────────────────┘
                    │ 去掉 /api/fava 前缀
                    │
┌───────────────────▼────────────────────┐       原生 HTTP 插件
│               Fava 内核                │ ◄────────────────────── ┌────────────────────────────────────────┐
│         http://127.0.0.1:5000          │                         │           BeanDesk 桌面端 (Tauri 2)     │
└───────────────────▲────────────────────┘                         │    - 本机设置与远程一键直连              │
                    │                                              │    - 本机 Fava 进程自动拉起与退出监管     │
┌───────────────────┴────────────────────┐                         └────────────────────────────────────────┘
│       用户纯文本账本 (.bean)            │
└────────────────────────────────────────┘
```

## 运行模式与开发

### 浏览器运行模式

1. 环境要求：
   - 包管理器：Bun 1.1 或更高版本
   - 会计内核：本地或内网运行的 Fava 实例（默认地址 http://127.0.0.1:5000）

2. 启动步骤：
   ```bash
   make install
   make dev
   ```
   浏览器打开 `http://127.0.0.1:5188`。开发代理自动将 `/api/fava` 转发至本地 Fava。

### 桌面客户端模式（Tauri 2）

在仓库根目录执行：

```bash
make desktop
```

桌面端通过 Tauri 原生网络层直连 Fava 实例，绕过浏览器跨域与混合内容限制。设置中提供两种连接方式：

- **本机启动**：选择工作目录。启动命令留空则用自带引擎，或填写自己的命令（`make run`、`fava a.bean b.bean`）。本窗口最多拉起一个 Fava。
- **连接已有**：填写已经在应答的地址。离开本机时建议走 Tailscale、WireGuard 这类私有网络。

![BeanDesk 桌面设置与进程托管](./docs/images/zh/settings.png)

桌面客户端支持 macOS、Windows 与 Linux 跨平台运行，内置自动更新检测与连接状态监控。推送与 `tauri.conf.json` 版本一致的 `v` 标签后，GitHub Actions 构建 Apple Silicon、Intel、Windows、Linux x64 与 Linux Arm 的安装包，并写入草稿 Release。五个任务都成功后再发布；发布之前，已安装的客户端看不到这次更新。这个版本没有手机端。更新包用仓库里的公钥验签。macOS 安装包是临时签名，没有 Apple 公证证书时，系统打开前仍会要求确认。

## 部署与安全规范

Fava 原生接口支持执行任意 BQL 查询与读取单据凭证，切勿将端口直接暴露在公网 IP。生产环境安全措施：

1. 本地绑定：将 Fava 与前端服务严格绑定在 127.0.0.1，不对公网开放入站端口。
2. 远程访问方案：
   - Cloudflare Tunnel 与 Cloudflare Access：通过内网穿透隧道访问，并在云端开启邮箱验证码或单点登录验证。
   - Tailscale 或 WireGuard：通过虚拟私有网络访问，仅允许加入内网的受信设备连接。

操作顺序、Caddy 反代与前端路由回退见 [DEPLOY.md](DEPLOY.md)。

## 目录结构与规范索引

```
BeanDesk/
├── AGENTS.md               # 前端工程规范与开发契约
├── DEPLOY.md               # 本机绑定、Caddy 反代与隧道部署
├── docs/
│   └── images/             # 界面截屏（中英文）
├── skills/                 # 智能体技能定义
│   └── fava-beancount-guide/ # 引导用户自建账本与记账合规规范
├── README.md               # 英文说明（默认）
├── README.zh-CN.md         # 中文说明
├── src-tauri/              # Tauri 2 桌面客户端外壳
└── web/                    # 前端代码目录
    ├── package.json
    ├── vite.config.ts
    ├── components.json
    └── src/
        ├── components/     # 通用组件与布局外壳
        ├── pages/          # 页面：试算平衡、资产负债表、利润表、现金流量表、明细账、BQL 查询
        ├── lib/            # 数据适配、现金流纯函数与接口客户端
        └── i18n/           # 语言包
```

记账规范与自建账本指引参见 [Fava 与 Beancount 记账指南](skills/fava-beancount-guide/SKILL.md)；前端工程规范参见 [AGENTS.md](AGENTS.md)。

## 测试与构建

在 web 目录下执行：

```bash
bun test
bun run build
```

## 赞助支持

BeanDesk 完全开源且免费。如果它为你节省了时间，欢迎赞助支持项目的持续维护与更新：

- **USDC (Solana 链)**：`CiZxojzWpKwXqxqbQQ8gN6Qb4pdGSuKzYA9MbX8ukFKK`
- **USDC (Base / Arbitrum / 以太坊)**：`0x43ad55b5fe79d1d8afee3425a6011cfb9a512927`

## 许可证

本项目采用 [GNU Affero General Public License v3.0 (AGPL-3.0)](./LICENSE) 协议开源。

