import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router'

import { AppShell } from '@/components/app-shell'
import { AppUpdate } from '@/components/app-update'
import { DesktopGuard, DesktopProvider } from '@/components/desktop-gate'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from '@/components/theme-provider'
import { I18nProvider } from '@/i18n'
import { TimeFilterProvider } from '@/lib/time-context'
import { BalanceSheet } from '@/pages/BalanceSheet'
import { CashFlow } from '@/pages/CashFlow'
import { IncomeStatement } from '@/pages/IncomeStatement'
import { Journal } from '@/pages/Journal'
import { QueryPlayground } from '@/pages/QueryPlayground'
import { Settings } from '@/pages/Settings'
import { TrialBalance } from '@/pages/TrialBalance'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="system">
        <I18nProvider>
          <AppUpdate>
          <TimeFilterProvider>
            <TooltipProvider>
              <DesktopProvider>
                <BrowserRouter>
                  <AppShell>
                    <DesktopGuard>
                      <Routes>
                        <Route path="/" element={<TrialBalance />} />
                        <Route path="/balance-sheet" element={<BalanceSheet />} />
                        <Route path="/income-statement" element={<IncomeStatement />} />
                        <Route path="/cash-flow" element={<CashFlow />} />
                        <Route path="/journal" element={<Journal />} />
                        <Route path="/query" element={<QueryPlayground />} />
                        <Route path="/settings" element={<Settings />} />
                      </Routes>
                    </DesktopGuard>
                  </AppShell>
                </BrowserRouter>
              </DesktopProvider>
            </TooltipProvider>
          </TimeFilterProvider>
          </AppUpdate>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
