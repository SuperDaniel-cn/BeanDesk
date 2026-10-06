# AGENTS.md

BeanDesk 前端与桌面端工程规范。

记账引导见 skills/fava-beancount-guide/SKILL.md。该技能只读写用户点名的工作目录；本仓库不附带账本，也不记录任何账本路径、科目、分录、凭证或备份信息。

## 1. 架构定位与职责边界

本项目是壳：只读报表工作台，直连 **一个** Fava，无自建后端、数据库或云账号。提供 Web 与 Tauri 2 桌面两种形态。

- 零定制后端：报表与查询只通过 HTTP 问 Fava。不算账，不自建会计引擎。
- 文件是用户的：`.bean` 与 `documents/` 在用户选定的工作目录。应用不托管云同步。需要时只写下第一本账的骨架，不做网页账本编辑器。
- 一个服务：桌面只拉起或连接一个 Fava。多本账是 Fava 多个根文件与 slug（`fava a.bean b.bean`），不是应用级换仓库、换连接。
- 引擎可换：外行空启动命令走发布包里的冻结 sidecar。极客填自己的启动命令，或只填已有地址。不解析、不改写用户命令。不内置生 Python。
- 前端核心：React 19、TypeScript、Vite、Tailwind CSS、shadcn/ui，代码在 web。
- 桌面外壳：src-tauri，窗口、HTTP 插件、这一个 Fava 进程的看管。主窗口创建时隐藏；主题和手册窗在内存里热好再 `show()`，不等 Fava。语言 `invoke` 必须有超时。Rust 只在几秒后仍看不见时兜底，避免再把显示挂在页面 Finished 上。托盘常驻：关主窗口或手册窗只隐藏；左键托盘或菜单「显示」聚焦主窗口；「退出」才结束进程并停 Fava。不办登录时启动。
- 职责隔离：本规范约束壳。复式记账与记分录由技能在用户目录里完成。

## 2. 接口通信与双通道规范

前端请求分两条通道处理，保持上层页面调用一致：

- 浏览器环境：开发阶段由 Vite 代理将 /api/fava 转发至 5000 端口；生产环境由 Caddy 等反向代理剥离前缀后转发。
- Tauri 桌面环境：使用 @tauri-apps/plugin-http 的 fetch 直接向用户配置的 Fava 根地址发请求，绕过浏览器跨域与混合内容拦截，不使用窗口内的原生 window.fetch 直连 Fava。
- 防御性解析：Fava 接口不返回自身版本号。适配层通过字段存在性校验与空值防护处理差异，不硬编码版本号。
- 状态管理与缓存联动：使用 TanStack Query 管理远程请求。受时间切片影响的 Query Key 带上当前片段记号：空字符串表示全部时期，其余为年份、季度或月份字符串。切换记号时刷新数据，不拆分起止日期字段。
- BQL 支持：查询控制台直接向 Fava 发送原生 BQL 并呈现数据，不增设私有查询方言。

## 3. 报表与现金流解耦契约

- 纯函数计算：现金流量表在 web/src/lib/cash-flow.ts 中实现为纯函数。输入分录与开户元数据，输出三类活动报表。
- 目录与账本解耦：法定行次目录留在前端代码中；科目归属严格通过 ledger_data.account_details 提取 open 指令上的 cash、cashflow、cashflow-in 与 cashflow-out 元数据。严禁在前端硬编码特定账本的私有科目路径。

## 4. 桌面设置与进程托管契约

- 配置持久化：桌面端连接地址与本机命令使用 @tauri-apps/plugin-store 存储在本机，不提交进 Git，也不写入 web/public/config.js。同一份记录里 `active` 只有 `local` 或 `remote`。切到仅连接不会清掉本机目录和启动命令，切到本机项目也不会清掉仅连接的地址。启动进程只看当前生效的本机项目。
- 进程看管原则：启动本机项目前先检测端口。已通则仅连接；未通则在独立进程组执行用户命令，等待就绪后再进入界面。退出时仅终止本次拉起的进程组。设置页展示的是现场快照（会话、端口探测、本窗口是否拥有进程）。Stop 只对 `owned`；PID 只存在本窗口内存里，不写入 store。图形界面只运行一个实例，再次启动只把已有主窗口拉到前面。带 `mcp` 参数的进程不进入这个限制。
- 运行环境：发布包装冻结的 `beandesk-engine` 目录（onedir：可执行文件加 `_internal`，不是单文件）。账本连接里三种方式互斥。内置引擎把 `launch` 写成 `engine`，已保存的命令留在记录里但不执行。外部命令把 `launch` 写成 `shell`，启动命令原样交给 shell，不解析、不改写，命令为空则不启动。地址直连只记 origin，不启动进程。已连接或正在启动时切换方式要先确认，确认后断开当前会话，不自动连上新的一条。没有冻品时报 `missing-engine`。不内置生 Python 解释器。
- 第一本账：`init_ledger` 只在用户选定的工作目录写技能里的骨架，并写下一个 `.beandesk` 标记。已有 `main.bean` 则报 `ledger-exists`。不开放通用写盘。骨架带上忽略 `.backup_key`、`.env` 与 `backups/` 的 `.gitignore`。没有这个标记的目录是已有账本，备份页的操作全部停用，也不做 Git 监听。
- 工作目录备份：设置 Backup 页。Git 自动保存只在工作目录里做快照（只纳入 `main.bean`、`config/`、`data/`），靠监听和防抖，没有额外的快照按钮。有 `.beandesk` 且开启 Git 自动保存时，启动监听并立刻打一份快照，之后仍按防抖。凭证不进 Git。加密备份走随包装的 restic 0.19.1：设口令后点备份；自动备份关闭时只在点备份时写；开启后写入已添加且就绪的目的地。目的地是确认后的条目，不是两个热槽位：本地目录和 S3 兼容桶（R2 / MinIO / AWS，字段对齐 PicGo S3）都可以加多条。添加或编辑都在对话框里确认后才写入 `backup.json`。旧的「一个本地 + 一个云端」槽位在加载时迁进 `dests[]`。每次都打 `main.bean`、`config/`、`data/`、`documents/`，只传新增或改动的数据块。改口令时给已经存在的仓库换钥匙。抽查失败会记在本机，下次即使内容没变也会再查。保留最近 48 小时的每一次快照，再按 30 天/12 周/24 个月变稀。内容没变时 `--skip-if-unchanged` 不另写一份。仓库不能嵌在账本目录里。备份、恢复、保存设置和测试存储这类可能等磁盘或网络的命令走 `spawn_blocking`，不占主线程；监听线程里不碰 `watch` 锁。口令经 `RESTIC_PASSWORD_FILE`，S3 凭证走环境变量，都不进进程参数。不办 BeanDesk 云、不代管桶、不自动 `git push`。备份配置在本机 `backup.json`，口令在工作目录 `.backup_key`，都不进 `connection.json`，也不进本仓库。日志不打密钥。开发机用 `make restic` 拉当前平台的二进制；发布时按目标 triple 拉同一版本并用发行 SHA256 校验。
- 启动命令：仓库根没有 package.json。浏览器使用 `make dev`，页面在 http://127.0.0.1:5188。桌面使用 `make desktop`，即 `bunx @tauri-apps/cli dev`。不要改成 `npm run tauri dev`，也不要在仓库根新建 Node 工程。
- 配置目录：CLI 会先进入 `src-tauri`。`beforeDevCommand` 和 `beforeBuildCommand` 用 `cwd: "../web"` 再执行 `bun run ensure-docs && bun run dev` / `bun run ensure-docs && bun run build`。不要把 `../web` 写进命令本身：从仓库根启动时前端目录是 `web/`，从 `src-tauri` 启动时前端目录会退回仓库根，命令里的 `../web` 会找不到目录。devUrl 与 Vite 的 host、port 保持一致。打包读取 `web/dist`。
- 连接日志：设置页上的每一行同时经 log 插件写入本机日志目录。单个文件上限 10MB，超过后从文件开头丢掉最旧的行，最近的内容留在原文件，不按日期另存。页面上的清除只清空当前窗口里的显示。
- 桌面更新：安装包只覆盖 macOS、Windows 和 Linux。推送与 `tauri.conf.json`、`web/package.json`、`src-tauri/Cargo.toml` 版本一致的 `v*` 标签才触发 `.github/workflows/release.yml`。先在一台小的 Ubuntu 上核对版本、签名密钥和前端构建，再开五个平台任务。产物写入草稿 Release，五个任务都成功后再手动发布；草稿不会成为 updater 的 latest。Linux 用 `ubuntu-22.04` 和公开仓库的 `ubuntu-22.04-arm`，不要换成模拟的 Arm 环境。更新签名的私钥只放在 GitHub Secret，公钥写在 `tauri.conf.json`。不提交私钥。这个版本不构建 Android 或 iOS。
- 日历订阅：日历页 `/calendar`，不进报表通道，也不进设置。来源和复制 ICS 在日历页的弹窗里，不在设置。同一时间只有一份来源：随包装的中国小规模按季目录、本机 `.ics`、或用户粘贴的 HTTPS ICS（`webcal://` 保存成 `https://`）。本机文件和 HTTPS 只在桌面可用；浏览器只看随包装目录。配置在本机 `calendar.json`，不进 `connection.json` / `backup.json`。打开时读一次当前来源；7 天内到期的事项每条 UID+日期只弹一次 Sonner 和系统横幅。关到托盘时进程还在；从托盘退出后不再提醒。不办提醒云、不轮询、不写 CalDAV、不把账本当日历。公开仓库里的 `calendars/*.ics` 是静态文件，不是我们运营的服务。手机提醒用同一条 HTTPS。读本机文件只走 `read_user_text_file`，只读用户选中的绝对路径。未连 Fava 也能打开日历页。
- 用户手册：桌面第二个窗口（label `handbook`），不进报表通道，也不进设置。主窗口就绪后先隐藏创建该窗口，手册图标只显示或聚焦，主窗口不离开当前页。关手册窗或主窗口都只隐藏；从托盘退出再一起拆掉。窗口加载随包装的 Fumadocs 静态导出（`/docs/index.html` 或 `/docs/zh-CN/index.html`），初始宽高与主窗口相同。未连 Fava 也能打开。不跑 DesktopProvider 启动或 AppUpdate 检查。不要把 Next 放进 `web/`。不办在线文档站。
- 本机 MCP：同一桌面二进制，参数只认独立的 `mcp`（不是 `--mcp`，也不看 argv0）。stdio JSON-RPC。读本机 `connection.json`，与设置页同一份工作目录和 Fava origin。目录工具：`get_connection`、`init_ledger`（写入必须 `confirmWrite`）、`check_ledger`。只读 Fava 工具转发界面已在用的 GET：`get_fava`、`get_ledger`、`run_bql`、三张表、`get_journal`、`list_documents`。手册工具 `get_handbook` 读随包装的 `docs/content` MDX：不传 `page` 列出目录，传入 slug 或标题读一页；`locale` 为 `en` 或 `zh-CN`。不需要 Fava。记分录仍由技能写月文件，不转发 `add_entries` / `source`。不猜账本仓库名，不开放备份、日历或凭证字节。设置页只复制 `{ command: 当前可执行文件, args: ["mcp"] }`。不办云 MCP，不监听 HTTP。

## 5. 技术栈与包管理约束

- 包管理器：必须使用 Bun 1.1 或更高版本，严禁使用 npm、yarn 或 pnpm 执行依赖安装或脚本运行。
- 组件库：基于 shadcn/ui，原子组件存放于 src/components/ui/。
- 国际化支持：文案由 src/i18n/ 统一管理，禁止在页面和组件中硬编码文本。新增键名需在 en.ts 与 zh-CN.ts 保持严格对齐。没有手动选择时，浏览器用 `navigator.languages`，桌面端用操作系统的首选语言。未本地化的桌面包里，WebView 的 `navigator.language` 会停在英语，不能当成用户的本机语言。

## 6. 界面设计规范

- 响应式布局：桌面端以紧凑表格呈现明细，移动端折叠为卡片流。顶栏导航在移动端自动折叠为侧边抽屉。
- 凭证穿透：交易分录与原始凭证在居中弹窗内预览。在桌面端通过 HTTP 插件获取凭证字节后做成本地对象预览。
- 图表克制：不引入图表与重型动画库，所有财务报表使用表格呈现。

## 7. 质量校验与交付标准

代码提交前在仓库根执行并通过 `make test`。它会跑 oxlint、测试文件的类型检查、`bun test` 和 `cargo test`。`make build` 会类型检查页面代码和测试，再构建前端。推送到 `main` 的检查与此相同。

## 8. 用户手册

- 用户手册在 `docs/`（独立 Fumadocs 包）。桌面手册窗口加载 `docs/out` 同步到 `web/public/docs` 的静态导出；MCP `get_handbook` 仍读同一份 MDX。用 `make docs` 在 http://127.0.0.1:3200/docs 预览。`make docs-sync` 或桌面 `ensure-docs` 负责导出。不办在线文档站。
- 仓库根不要新建 package.json。
- 不要把 Next 放进 `web/`。
