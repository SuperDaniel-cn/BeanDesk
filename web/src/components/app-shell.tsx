import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { NavLink, useLocation } from 'react-router'
import { Menu, Settings } from 'lucide-react'

import { REPORT_PAGES } from '@/app-pages'
import { BrandMark } from '@/components/brand-mark'
import { LedgerErrors } from '@/components/ledger-errors'
import { StartupLoading, useStartupScreen } from '@/components/startup-loading'
import { TimeFilterSelector } from '@/components/time-filter-selector'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title
  }, [title])
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const starting = useStartupScreen()
  const [mobileOpen, setMobileOpen] = useState(false)
  const pageKey =
    REPORT_PAGES.find((page) => page.path === pathname)?.key
    ?? (pathname === '/settings' ? 'settings.title' : REPORT_PAGES[0].key)
  const brand = t('brand.short')
  const settingsDesktop = pathname === '/settings' && isTauri()
  useDocumentTitle(`${t(pageKey)} - ${brand}`)
  useLayoutEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  if (starting) return <StartupLoading />

  return (
    <div className={cn('flex flex-col bg-background', settingsDesktop ? 'h-svh overflow-hidden' : 'min-h-svh')}>
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-1 px-2 sm:gap-2 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-1">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="md:hidden"
                  aria-label={t('nav.menu')}
                >
                  <Menu />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <SheetHeader className="border-b p-4 text-left">
                  <SheetTitle className="flex items-center gap-2">
                    <BrandMark />
                    {brand}
                  </SheetTitle>
                </SheetHeader>
                <nav className="flex flex-col gap-1 p-3">
                  {REPORT_PAGES.map(({ path, key, icon: Icon }) => (
                    <NavLink
                      key={path}
                      to={path}
                      end={path === '/'}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-secondary text-secondary-foreground'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )
                      }
                    >
                      <Icon className="size-4 shrink-0" />
                      <span>{t(key)}</span>
                    </NavLink>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>

            <NavLink
              to="/"
              className="flex items-center gap-1.5 whitespace-nowrap font-heading text-sm font-semibold tracking-tight"
            >
              <BrandMark />
              <span>{brand}</span>
            </NavLink>
          </div>

          <nav className="hidden md:flex items-center gap-0.5">
            {REPORT_PAGES.map(({ path, key }) => (
              <NavLink
                key={path}
                to={path}
                end={path === '/'}
                className={({ isActive }) =>
                  cn(
                    buttonVariants({
                      variant: isActive ? 'secondary' : 'ghost',
                    }),
                  )
                }
              >
                {t(key)}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-1 sm:gap-2">
            <TimeFilterSelector />
            <NavLink
              to="/settings"
              aria-label={t('settings.title')}
              className={({ isActive }) =>
                cn(buttonVariants({ variant: isActive ? 'secondary' : 'ghost', size: 'icon-sm' }))
              }
            >
              <Settings />
            </NavLink>
          </div>
        </div>
      </header>

      <main
        className={
          settingsDesktop
            ? 'flex min-h-0 w-full flex-1 flex-col'
            : 'mx-auto flex w-full max-w-7xl flex-col gap-6 px-3 py-6 sm:px-6 sm:py-8 lg:px-8'
        }
      >
        {settingsDesktop ? null : <LedgerErrors />}
        {children}
      </main>
    </div>
  )
}
