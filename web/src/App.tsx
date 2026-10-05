import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router'

import { AppShell } from '@/components/app-shell'
import { AppUpdate } from '@/components/app-update'
import { DesktopGuard, DesktopProvider } from '@/components/desktop-gate'
import { KeptReports } from '@/components/kept-reports'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from '@/components/theme-provider'
import { I18nProvider } from '@/i18n'
import { TimeFilterProvider } from '@/lib/time-context'
import { Calendar } from '@/pages/Calendar'
import { Settings } from '@/pages/Settings'

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
                      <KeptReports />
                      <Routes>
                        <Route path="/calendar" element={<Calendar />} />
                        <Route path="/settings" element={<Settings />} />
                      </Routes>
                    </DesktopGuard>
                  </AppShell>
                </BrowserRouter>
                <Toaster position="bottom-right" />
              </DesktopProvider>
            </TooltipProvider>
          </TimeFilterProvider>
          </AppUpdate>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
