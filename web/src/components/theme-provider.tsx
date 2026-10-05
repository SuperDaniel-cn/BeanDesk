import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Theme = 'dark' | 'light' | 'system'

function isDarkTheme(theme: Theme): boolean {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return theme === 'dark'
}

interface ThemeProviderState {
  theme: Theme
  setTheme: (theme: Theme) => void
  isDark: boolean
}

const ThemeContext = createContext<ThemeProviderState>({
  theme: 'system',
  setTheme: () => null,
  isDark: false,
})

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'beancount-theme',
}: {
  children: ReactNode
  defaultTheme?: Theme
  storageKey?: string
}) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  )
  const [isDark, setIsDark] = useState(() => isDarkTheme(theme))

  useEffect(() => {
    const root = window.document.documentElement

    const applyTheme = () => {
      const dark = isDarkTheme(theme)
      root.classList.remove('light', 'dark')
      root.classList.add(dark ? 'dark' : 'light')
      setIsDark(dark)
    }

    applyTheme()

    if (theme === 'system') {
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      const listener = () => applyTheme()
      media.addEventListener('change', listener)
      return () => media.removeEventListener('change', listener)
    }
  }, [theme])

  const value = {
    theme,
    setTheme: (newTheme: Theme) => {
      localStorage.setItem(storageKey, newTheme)
      setTheme(newTheme)
    },
    isDark,
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}
