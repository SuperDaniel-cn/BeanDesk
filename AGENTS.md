# AGENTS.md

BeanDesk 前端与桌面端工程规范。

记账引导见 skills/fava-beancount-guide/SKILL.md。该技能引导用户自建账本；本仓库不附带账本，也不记录任何账本路径、科目、分录、凭证或备份信息。

## 1. 架构定位与职责边界

本项目为只读财务前端工作台，直连 Fava，无自建后端与数据库。提供 Web 页面与 Tauri 2 桌面壳两种运行形态：

- 零定制后端：不引入自定义后端服务或独立数据库。报表与数据查询直接通过 HTTP 与 Fava 通信。
- 前端核心：React 19、TypeScript、Vite、Tailwind CSS、shadcn/ui，代码存放在 web 目录。
- 桌面外壳：Tauri 2 位于 src-tauri 目录，负责桌面窗口宿主、网络转发与本机 Fava 进程生命周期托管。
- 职责隔离：本规范约束前端与桌面外壳代码。复式记账合规与用户自建账本的初始化由技能模块处理。

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
- 进程看管原则：启动本机项目前先检测端口。已通则仅连接；未通则在独立进程组执行用户命令，等待就绪后再进入界面。退出时仅终止本次拉起的进程组。
- 运行环境解耦：BeanDesk 不内置 Python 运行环境，不解析或篡改用户填写的启动命令。
- 启动命令：仓库根没有 package.json。浏览器使用 `make dev`，页面在 http://127.0.0.1:5188。桌面使用 `make desktop`，即 `bunx @tauri-apps/cli dev`。不要改成 `npm run tauri dev`，也不要在仓库根新建 Node 工程。
- 配置目录：CLI 会先进入 `src-tauri`。`beforeDevCommand` 和 `beforeBuildCommand` 用 `cwd: "../web"` 再执行 `bun run dev` / `bun run build`。不要把 `../web` 写进命令本身：从仓库根启动时前端目录是 `web/`，从 `src-tauri` 启动时前端目录会退回仓库根，命令里的 `../web` 会找不到目录。devUrl 与 Vite 的 host、port 保持一致。打包读取 `web/dist`。
- 连接日志：设置页上的每一行同时经 log 插件写入本机日志目录。单个文件上限 10MB，超过后从文件开头丢掉最旧的行，最近的内容留在原文件，不按日期另存。页面上的清除只清空当前窗口里的显示。
- 桌面更新：安装包只覆盖 macOS、Windows 和 Linux。推送与 `tauri.conf.json`、`web/package.json`、`src-tauri/Cargo.toml` 版本一致的 `v*` 标签才触发 `.github/workflows/release.yml`。先在一台小的 Ubuntu 上核对版本、签名密钥和前端构建，再开五个平台任务。产物写入草稿 Release，五个任务都成功后再手动发布；草稿不会成为 updater 的 latest。Linux 用 `ubuntu-22.04` 和公开仓库的 `ubuntu-22.04-arm`，不要换成模拟的 Arm 环境。更新签名的私钥只放在 GitHub Secret，公钥写在 `tauri.conf.json`。不提交私钥。这个版本不构建 Android 或 iOS。

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
