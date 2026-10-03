import { Banknote, BookOpen, FileSpreadsheet, Landmark, Scale, Terminal } from 'lucide-react'
import type { ComponentType } from 'react'

import type { MessageKey } from '@/i18n/locales/en'
import { BalanceSheet } from '@/pages/BalanceSheet'
import { CashFlow } from '@/pages/CashFlow'
import { IncomeStatement } from '@/pages/IncomeStatement'
import { Journal } from '@/pages/Journal'
import { QueryPlayground } from '@/pages/QueryPlayground'
import { TrialBalance } from '@/pages/TrialBalance'

export const REPORT_PAGES: Array<{
  path: string
  key: MessageKey
  icon: ComponentType<{ className?: string }>
  Page: ComponentType
}> = [
  { path: '/', key: 'trialBalance.title', icon: Scale, Page: TrialBalance },
  { path: '/balance-sheet', key: 'balanceSheet.title', icon: Landmark, Page: BalanceSheet },
  { path: '/income-statement', key: 'income.title', icon: FileSpreadsheet, Page: IncomeStatement },
  { path: '/cash-flow', key: 'cashFlow.title', icon: Banknote, Page: CashFlow },
  { path: '/journal', key: 'journal.title', icon: BookOpen, Page: Journal },
  { path: '/query', key: 'query.title', icon: Terminal, Page: QueryPlayground },
]
