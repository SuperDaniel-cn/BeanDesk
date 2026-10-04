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
    rangeJoiner: '至',
    exportCsv: '导出 CSV',
    section: '部分',
    errorFallback: '没有拿到可用的数据',
  },

  fava: {
    unreachable: '连不上 Fava。请在 127.0.0.1:5000 启动，或在 config.js 里设置 apiBaseUrl',
    slug: '无法确定账套 slug。请在 config.js 里设置 slug',
    slugInvalid: 'config.js 里的账套 slug 无效',
  },

  ledger: {
    errorsTitle: {
      other: '{count} 条账本错误',
    },
  },

  compare: {
    delta: '差额',
    priorUnavailableTitle: '去年同期没有加载成功',
    priorUnavailable: '本期数字仍在',
  },

  time: {
    allTime: '全部时期',
    year: '年度',
    quarter: '季度',
    month: '月份',
    periodYear: '{year}年',
    periodQuarter: '{year}年{quarter}季',
    periodMonth: '{year}年{month}月',
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

  boot: {
    connecting: '正在连接账本',
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
    empty: '该账本没有可报告的余额',
    unconvertedTitle: '部分余额没有汇率',
    unconvertedBody:
      '{currencies} 没有折算为 {currency} 的汇率。这些金额按原币计入，合计是近似值',
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
    empty: '未找到匹配的科目余额',
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
    empty: '该期间没有收入和费用',
    errorTitle: '无法加载利润表',
  },

  query: {
    title: '查询',
    running: '执行中…',
    run: '运行',
    placeholder: "SELECT date, payee, narration, position WHERE account ~ '^Expenses' ORDER BY date DESC",
    shortcut: 'Ctrl + Enter',
    errorTitle: '查询失败',
    errorFallback: '查询没有执行成功',
    resultsTitle: '查询结果',
    resultsSummary: '{columns} 列 · {rows} 行',
    resetSort: '恢复排序',
    emptyTitle: '没有记录',
    emptyDescription: '查询已执行，没有返回记录',
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
    tabGeneral: '常规设置',
    tabSimple: '账本连接',
    tabGeek: '高级连接',
    tabBackup: '数据备份',
    backupSectionLocal: 'Git 自动保存',
    backupSectionEncrypt: 'AES-256-CBC，带 salt，PBKDF2 100000 次，参数与 OpenSSL 一致。',
    backupWatch: 'Git 自动保存',
    backupWatchHint: '仅追踪核心财务资产（main.bean、config/、data/、documents/），自动过滤密钥与临时文件。',
    backupDebounce: '防抖间隔（秒）',
    backupNow: '备份',
    backupOpen: '打开文件夹',
    backupNeedFolder: '尚未选择账本工作目录，请先在连接设置中选择账本路径。',
    backupGitOk: '本地快照已生成（提交：{hash}）',
    backupEncrypt: '加密备份',
    backupArchiveAuto: '自动备份',
    backupArchiveAutoHint: '开启后，备份写入已选的目的地；关闭时，备份会弹出另存为。',
    backupArchiveLocal: '本地',
    backupArchiveCloud: '云端',
    backupArchiveDirectory: '备份目录',
    backupOk: '加密备份已写出',
    backupErrorArchiveDest: '已开启自动备份，但还没有选择目的地。',
    backupErrorArchiveDir: '请先选择本地备份目录。',
    backupErrorArchiveNested: '备份目录不能放在账本目录里，否则会把备份再打进下一份。',
    backupKey: '密钥设置',
    backupKeySave: '保存密钥',
    backupKeySet: '当前工作目录已保存加密密钥（.backup_key）',
    backupRestore: '恢复',
    backupRestoreOk: '已从加密归档恢复',
    backupS3Hint: '兼容 AWS S3 协议（如 Cloudflare R2、MinIO、AWS S3）。本地加密后直传，不依赖第三方中间服务器。',
    backupS3Endpoint: '终端节点地址 (Endpoint URL)',
    backupS3Bucket: '存储桶名称 (Bucket Name)',
    backupS3Region: '存储区域 (Region)',
    backupS3AccessKey: '访问密钥 ID (Access Key ID)',
    backupS3Secret: '私有访问密钥 (Secret Access Key)',
    backupS3PathStyle: '路径寻址访问（Path-style，MinIO / R2 建议开启）',
    backupS3Prefix: '存储路径前缀 (Prefix，如 backups/)',
    backupS3Test: '测试存储连接',
    backupS3TestOk: '存储连接测试成功',
    backupKeep: '历史归档保留份数',
    backupLastArchive: '最近本地加密归档',
    backupLastUpload: '最近云端上传对象',
    backupErrorGit: '创建本地 Git 快照失败',
    backupErrorKey: '请先设置归档加密密钥',
    backupErrorEncrypt: '数据加密或解密失败',
    backupErrorS3Endpoint: '终端节点地址格式错误：请填写以 https:// 开头的主机地址（不包含路径或桶名）',
    backupErrorS3Config: '缺少必填凭据：Access Key ID、Secret Access Key 与存储桶名称均为必填项',
    backupErrorS3: '云端归档上传失败',
    backupErrorCheck: '恢复数据完整性校验失败（bean-check 未通过）',
    backupBrowser: '数据备份与本地快照功能仅在桌面客户端中可用。',
    simpleDirectory: '账本目录',
    hostStatus: '服务状态',
    connectionMode: '连接方式',
    local: '本机服务',
    remote: '外部服务',
    directory: '账本目录',
    browse: '选择文件夹',
    createFirstLedger: '初始化账本',
    createFirstLedgerDone: '已在当前目录初始化账本骨架',
    createFirstLedgerExists: '当前目录中已存在账本（main.bean）',
    createFirstLedgerNotEmpty: '当前目录非空。请选择空文件夹初始化，或直接连接已有账本',
    command: '启动命令',
    commandPlaceholder: 'fava --host 127.0.0.1 --port 5000 main.bean',
    origin: '服务地址',
    connect: '连接',
    connecting: '正在连接',
    stop: '停止',
    disconnect: '断开连接',
    hostSessionBoot: '正在连接',
    hostSessionSetup: '未连接',
    hostSessionReady: '已连接',
    hostPleaseConnect: '未连接账本服务',
    hostPortOccupied: '目标端口已被占用，且非有效 Fava 服务',
    hostOwned: '当前窗口托管运行',
    hostAttached: '已接入外部运行服务',
    hostDown: '账本服务已停止响应',
    hostUptimeSeconds: '已运行 {count} 秒',
    hostUptimeMinutes: '已运行 {count} 分钟',
    loopback: '本机启动时，服务地址必须为本地回环（127.0.0.1 或 localhost）',
    invalidOrigin: '服务地址格式无效，请填写如 http://127.0.0.1:5000（不含路径）',
    missingDirectory: '请选择账本文件夹',
    missingWorkDirectory: '请选择账本工作目录',
    missingCommand: '请填写启动命令',
    missingEngine: '当前安装包未包含适用于此系统的内置引擎。请在高级连接中填写启动命令，或连接已运行的外部服务',
    startFailed: '未能启动账本服务：{detail}',
    startExited: '进程已启动但未能在指定端口就绪',
    notLocal: '当前配置为连接外部服务，不会在本地拉起进程',
    log: '链接日志',
    logKept: '日志已持久化存储至本地文件，此处仅清空当前界面显示',
    logEmpty: '暂无日志记录',
    logExpand: '展开',
    logCollapse: '收起',
    clearLog: '清除',
    copyLog: '复制',
    copied: '已复制',
    logNone: '尚未配置连接',
    logAttach: '检测到已运行的账本服务，正在接入',
    logStart: '正在启动账本服务',
    logStop: '服务已停止',
    logDisconnect: '已断开连接（外部账本服务仍在继续运行）',
    logHeld: '上次已停止，需重新连接',
    logReleased: '已停止本地托管服务，切换为连接外部服务',
  },

  documents: {
    title: '凭证与交付证据',
    searchPlaceholder: '搜索文件或科目',
    date: '日期',
    account: '科目',
    file: '文件',
    empty: '这个期间没有凭证',
    errorTitle: '无法加载凭证',
    preview: '预览',
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
    truncated: '结果被截断了。请缩小期间后再看剩余分录',
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
    noDocumentBody: '这笔分录没有关联凭证',
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
    check: '检查更新',
    checking: '正在检查',
    none: '已经是当前版本',
    failed: '这次没有完成更新检查',
    title: '有新版本',
    available: '可以安装 {version}',
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
