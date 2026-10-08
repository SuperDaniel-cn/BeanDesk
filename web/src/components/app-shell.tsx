import { Fragment, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { NavLink, useLocation } from 'react-router'
import { BookOpenText, CalendarDays, Menu, Settings } from 'lucide-react'

import { REPORT_PAGES, navLabelKey } from '@/app-pages'
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
import { useTheme } from '@/components/theme-provider'
import { Hint } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { openHandbookWindow } from '@/lib/handbook-window'
import { cn } from '@/lib/utils'

function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title
    if (!isTauri()) return
    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
      .catch(() => undefined)
  }, [title])
}

function HandbookControl({
  appearance,
  onOpened,
}: {
  appearance: 'icon' | 'sheet'
  onOpened?: () => void
}) {
  const { t, locale } = useI18n()
  const { isDark } = useTheme()
  const label = t('handbook.title')
  if (!isTauri()) return null
  const windowTitle = t('brand.window')

  const open = () => {
    onOpened?.()
    void openHandbookWindow(windowTitle, locale, isDark ? 'dark' : 'light').catch(() => undefined)
  }

  if (appearance === 'icon') {
    return (
      <Button variant="ghost" size="icon-sm" aria-label={label} onClick={open}>
        <BookOpenText />
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      aria-label={label}
      className="h-auto justify-start gap-2.5 px-3 py-2 text-muted-foreground"
      onClick={open}
    >
      <BookOpenText data-icon="inline-start" />
      <span>{label}</span>
    </Button>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const starting = useStartupScreen()
  const [mobileOpen, setMobileOpen] = useState(false)
  const brand = t('brand.short')
  const settingsDesktop = pathname === '/settings' && isTauri()
  const calendarPage = pathname === '/calendar'
  const hideLedgerErrors = settingsDesktop || calendarPage
  useDocumentTitle(t('brand.window'))
  useLayoutEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  if (starting) return <StartupLoading />

  return (
    <div className={cn('flex flex-col bg-background', settingsDesktop || calendarPage ? 'h-svh overflow-hidden' : 'min-h-svh')}>
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-1 px-2 sm:gap-2 sm:px-6 lg:px-8">
          <div className="flex shrink-0 items-center gap-1">
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
                  <NavLink
                    to="/calendar"
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
                    <CalendarDays className="size-4 shrink-0" />
                    <span>{t('calendar.title')}</span>
                  </NavLink>
                  <HandbookControl appearance="sheet" onOpened={() => setMobileOpen(false)} />
                </nav>
              </SheetContent>
            </Sheet>

            <NavLink
              to="/"
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap font-heading text-sm font-semibold tracking-tight"
            >
              <BrandMark />
              <span>{brand}</span>
            </NavLink>
          </div>

          <nav className="hidden md:flex min-w-0 items-center gap-0.5">
            {REPORT_PAGES.map((page) => {
              const { path, key, navKey } = page
              const link = (
                <NavLink
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
                  {t(navLabelKey(page))}
                </NavLink>
              )
              return (
                <Fragment key={path}>
                  {navKey ? <Hint label={t(key)}>{link}</Hint> : link}
                </Fragment>
              )
            })}
          </nav>

          <div className="flex items-center gap-1 sm:gap-2">
            <TimeFilterSelector />
            <NavLink
              to="/calendar"
              aria-label={t('calendar.title')}
              className={({ isActive }) =>
                cn(buttonVariants({ variant: isActive ? 'secondary' : 'ghost', size: 'icon-sm' }))
              }
            >
              <CalendarDays />
            </NavLink>
            <HandbookControl appearance="icon" />
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
            : calendarPage
              ? 'mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col px-3 py-6 sm:px-6 sm:py-8 lg:px-8'
              : 'mx-auto flex w-full max-w-7xl flex-col gap-6 px-3 py-6 sm:px-6 sm:py-8 lg:px-8'
        }
      >
        {hideLedgerErrors ? null : <LedgerErrors />}
        {children}
      </main>
    </div>
  )
}
