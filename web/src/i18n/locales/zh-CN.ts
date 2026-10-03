import { type LeafPaths, type NoMissingKeys } from '../catalog'
import { en } from './en'

/**
 * Simplified Chinese catalogue.
 *
 * Chinese has a single CLDR plural category (`other`), so pluralised keys only
 * need that one form — the plural machinery still resolves correctly because
 * `other` is the mandatory fallback in `PluralForms`.
 *
 * Keep `{placeholder}` names verbatim. The UI fills in dates, counts, and
 * currency codes.
 */
export const zhCN = {
  common: {
    refresh: '刷新',
    retry: '重试',
    asOf: '截至 {date}',
    errorFallback: '没有拿到可用的数据。',
  },

  fava: {
    unreachable: '连不上 Fava。请在 127.0.0.1:5000 启动，或在 config.js 里设置 apiBaseUrl。',
    slug: '无法确定账套 slug。请在 config.js 里设置 slug。',
    slugInvalid: 'config.js 里的账套 slug 无效。',
  },

  ledger: {
    errorsTitle: {
      other: '{count} 条账本错误',
    },
  },

  compare: {
    current: '本期',
    prior: '去年同期',
    delta: '差额',
  },

  time: {
    allTime: '全部时期',
    year: '年度',
    quarter: '季度',
    month: '月份',
    filterLabel: '期间',
    yearAndQuarter: '年度和季度',
    selectPeriod: '选择期间',
    quickFilters: '快捷筛选',
  },

  locale: {
    switcherLabel: '语言',
  },

  brand: {
    short: 'BeanDesk',
  },

  nav: {
    menu: '打开导航',
  },

  balanceSheet: {
    title: '资产负债表',
    account: '科目',
    amount: '金额',
    assets: '资产',
    liabilities: '负债',
    equity: '所有者权益',
    totalAssets: '资产总计',
    totalLiabilities: '负债总计',
    totalEquity: '所有者权益总计',
    totalLiabilitiesAndEquity: '负债和所有者权益总计',
    unclosedEarnings: '累计损益（未结转）',
    earnings: '本年损益',
    balanced: '平衡',
    unbalanced: '不平衡',
    journalLink: '在日记账中查看{account}',
    toggle: '{action} {account}',
    expand: '展开',
    collapse: '收起',
    errorTitle: '无法加载资产负债表',
    empty: '该账本没有可报告的余额。',
    unconvertedTitle: '部分余额没有汇率',
    unconvertedBody:
      '{currencies} 没有折算为 {currency} 的汇率。这些金额按原币计入，合计是近似值。',
  },

  trialBalance: {
    title: '试算平衡表',
    debitTotal: '借方合计',
    creditTotal: '贷方合计',
    netImbalance: '借贷差额',
    balanced: '借贷平衡',
    unbalanced: '检测到账目不平衡',
    searchPlaceholder: '按科目名称过滤...',
    expandAll: '展开全部',
    collapseAll: '折叠全部',
    debitColumn: '借方',
    creditColumn: '贷方',
    sectionTotal: '{name}合计',
    empty: '未找到匹配的科目余额。',
    errorTitle: '无法加载试算平衡表',
    roots: {
      assets: '资产',
      liabilities: '负债',
      equity: '所有者权益',
      income: '收入',
      expenses: '费用',
    },
  },

  theme: {
    label: '主题',
    light: '浅色',
    system: '跟随系统',
    dark: '深色',
  },

  cashFlow: {
    title: '现金流量表',
    period: '{from} 至 {to}',
    item: '项目',
    amount: '金额',
    operating: '经营活动',
    investing: '投资活动',
    financing: '筹资活动',
    operatingNet: '经营活动产生的现金流量净额',
    investingNet: '投资活动产生的现金流量净额',
    financingNet: '筹资活动产生的现金流量净额',
    unassigned: '未归类',
    netIncrease: '现金净增加额',
    errorTitle: '无法加载现金流量表',
    lines: {
      sales: '销售产成品、商品、提供劳务收到的现金',
      'operating-other-in': '收到其他与经营活动有关的现金',
      purchases: '购买原材料、商品、接受劳务支付的现金',
      wages: '支付的职工薪酬',
      taxes: '支付的税费',
      'operating-other-out': '支付其他与经营活动有关的现金',
      'investment-proceeds': '收回投资收到的现金',
      'investment-income': '取得投资收益收到的现金',
      'asset-disposal': '处置固定资产、无形资产和其他非流动资产收回的现金净额',
      'investment-acquire': '投资支付的现金',
      capex: '购建固定资产、无形资产和其他非流动资产支付的现金',
      borrowings: '取得借款收到的现金',
      capital: '吸收投资者投资收到的现金',
      'debt-principal': '偿还借款本金支付的现金',
      'debt-interest': '偿还借款利息支付的现金',
      dividends: '分配利润支付的现金',
    },
  },

  income: {
    title: '利润表',
    revenueTitle: '收入',
    expensesTitle: '费用',
    totalRevenue: '收入合计',
    totalExpenses: '费用合计',
    profitTitle: '净利润',
    period: '{from} 至 {to}',
    empty: '该期间没有收入和费用。',
    errorTitle: '无法加载利润表',
  },

  query: {
    title: '查询',
    exportCsv: '导出 CSV',
    running: '执行中…',
    run: '运行',
    placeholder: "SELECT date, payee, narration, position WHERE account ~ '^Expenses' ORDER BY date DESC",
    shortcut: 'Ctrl + Enter',
    errorTitle: '查询失败',
    errorFallback: '查询没有执行成功。',
    resultsTitle: '查询结果',
    resultsSummary: '{columns} 列 · {rows} 行',
    resetSort: '恢复排序',
    emptyTitle: '没有记录',
    emptyDescription: '查询已执行，没有返回记录。',
    presets: {
      monthly: {
        title: '各月收入与费用',
        description: '按年月汇总收入与费用',
      },
      largeExpenses: {
        title: '金额最大的费用',
        description: '金额最大的 50 笔费用',
      },
      cashAccounts: {
        title: '库存现金与银行存款',
        description: '银行存款与库存现金的余额',
      },
      payees: {
        title: '费用对方',
        description: '按对方汇总费用金额和笔数',
      },
      tags: {
        title: '带标签的分录',
        description: '列出打了标签的分录',
      },
      recent: {
        title: '最近 50 笔分录',
        description: '最近的分录',
      },
    },
  },

  settings: {
    title: '设置',
    local: '本机项目',
    remote: '仅连接',
    directory: '账本目录',
    browse: '选择目录',
    command: '启动命令',
    commandPlaceholder: 'fava --host 127.0.0.1 --port 5000 main.bean',
    setupTitle: '快速连接',
    setupBody: 'BeanDesk 通过只读接口直连 Fava 获取财务报表。如本地未安装：',
    setupInstallLead: '终端一行安装：',
    setupInstallCommand: 'pip install fava',
    setupAgentLead: '发给 AI 助手（Cursor / Claude Code / 本地 Agent）：',
    setupAgentPrompt: '帮我安装 Fava 和 Beancount，并启动本地 5000 端口演示账本',
    setupCopyPrompt: '复制指令',
    setupCopiedPrompt: '已复制',
    setupModesHint: '已有服务时，在下方选择「本机项目」自动托管启动，或选择「仅连接」接入私有网络地址。',
    setupFavaDocs: 'Fava 官方文档',
    setupBeancountDocs: 'Beancount 文档',
    origin: 'Fava 地址',
    connect: '连接',
    connecting: '正在连接',
    autoConnecting: '自动连接中',
    stop: '停止',
    loopback: '本机项目只能使用 127.0.0.1 或 localhost。',
    invalidOrigin: '请填写不带路径的 http 或 https 地址。',
    missingDirectory: '请选择账本目录。',
    missingCommand: '请填写启动命令。',
    startFailed: '启动命令没有跑起来。{detail}',
    startExited: '启动命令退出了，Fava 还没有接上这个端口。',
    occupied: '这个地址现在不是 Fava。',
    notLocal: '这条记录不会启动进程。',
    exclusive: '两种方式只有一种生效。另一种的目录、命令和地址仍留在本机。',
    log: '连接日志',
    logKept: '这些记录会写入本机日志。清除只清空这个框。',
    logEmpty: '还没有记录',
    clearLog: '清除',
    copyLog: '复制',
    copied: '已复制',
    logBoot: '正在连接',
    logNone: '没有已保存的连接',
    logAttach: 'Fava 已在运行，直接连接',
    logStart: '正在启动',
    logReady: '已连接',
    logStop: '已停止，下次启动需手动连接',
    logDisconnect: '已断开，进程仍在运行，下次启动需手动连接',
    logHeld: '上次已停止，需手动连接',
    logReleased: '已停止本机项目，切换为仅连接',
  },

  journal: {
    title: '日记账',
    drillTitle: '已按一个科目筛选',
    clearFilter: '取消筛选',
    searchPlaceholder: '搜索对方、摘要或科目',
    rootLabel: '会计要素',
    tagsLabel: '标签',
    allTags: '全部标签',
    emptyTitle: '没有符合条件的分录',
    truncated: '结果被截断了。请缩小期间后再看剩余分录。',
    viewDocument: '查看凭证',
    date: '日期',
    payee: '对方',
    narration: '摘要',
    debit: '借方',
    credit: '贷方',
    document: '凭证',
    dialogTitle: '凭证',
    dialogMeta: '{date}',
    documentsHeading: '发票和回单',
    download: '下载',
    previewTitle: '凭证预览',
    previewAlt: '发票或回单',
    noDocumentTitle: '没有凭证',
    noDocumentBody: '这笔分录没有关联凭证。',
    roots: {
      all: '全部',
      assets: '资产',
      liabilities: '负债',
      income: '收入',
      expenses: '支出',
      equity: '权益',
    },
    listTitle: {
      other: '{count} 笔',
    },
  },

  update: {
    label: '更新',
    currentVersion: '当前版本：{version}',
    check: '检查更新',
    checking: '正在检查',
    none: '已经是当前版本。',
    failed: '这次没有完成更新检查。',
    title: '有新版本',
    available: '可以安装 {version}。',
    install: '安装并重新打开',
    later: '稍后',
    installing: '正在安装',
  },
}

/* ------------------------------------------------------------------------- #
 * Compile-time completeness checks.
 *
 * A missing translation fails `tsc`, naming the exact dot-path. An extra key
 * (typically a typo, or a key English has since removed) fails too, so the two
 * catalogues cannot drift apart.
 * ------------------------------------------------------------------------- */

export type MissingChineseKeys = NoMissingKeys<
  Exclude<LeafPaths<typeof en>, LeafPaths<typeof zhCN>>
>

export type ObsoleteChineseKeys = NoMissingKeys<
  Exclude<LeafPaths<typeof zhCN>, LeafPaths<typeof en>>
>
