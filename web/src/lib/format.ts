/**
 * Presentation helpers.
 *
 * Two separate concerns live here:
 *
 * 1. **Sign convention** (AGENTS.md §3.4) — Beancount stores Income, Liabilities
 *    and Equity as negative. `toDisplay()` is applied per figure at the call
 *    site, never blanket across a payload: assets, expenses and net worth are
 *    already correct as signed, while revenue, profit, capital and shareholder
 *    loans need flipping.
 * 2. **Locale-aware formatting** — every formatter takes an explicit BCP-47 tag.
 *    Components should not call these directly; the i18n layer binds the active
 *    locale and exposes them through `useI18n()`.
 */

/** Last path segment of a Fava document filename. */
export function fileLeaf(filename: string): string {
  return filename.split('/').pop() || filename
}

/** Leaf names are `English-中文`. Show the Chinese segment when it is there. */
export function displayAccountName(name: string): string {
  const hyphen = name.lastIndexOf('-')
  if (hyphen < 0) return name
  const tail = name.slice(hyphen + 1)
  if (tail && /[\u4e00-\u9fff]/.test(tail)) return tail
  return name
}

/** Flip a Beancount-native figure so income/profit/owed-money reads positive. */
export function toDisplay(raw: number): number {
  // `-0` formats as a negative currency. Zero stays unsigned.
  return -raw || 0
}

/** Income is a credit in Beancount. Expenses already read as positive debits. */
export function presentIncome(section: 'income' | 'expenses', raw: number): number {
  return section === 'income' ? toDisplay(raw) : raw
}

/** Liabilities and equity are credits. Assets already read as positive debits. */
export function presentBalance(
  section: 'assets' | 'liabilities' | 'equity',
  raw: number,
): number {
  return section === 'assets' ? raw : toDisplay(raw)
}

export function formatNumber(
  value: number,
  locale: string,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(locale, options).format(value)
}

export function formatCurrency(
  value: number,
  currency: string,
  locale: string,
  options: Intl.NumberFormatOptions = {},
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
      ...options,
    }).format(value)
  } catch {
    // Unknown/invalid ISO code — fall back to a plain number plus the code.
    return `${formatNumber(value, locale, { maximumFractionDigits: 2 })} ${currency}`
  }
}

/** Signed currency, used for figures where direction carries meaning. */
export function formatSignedCurrency(
  value: number,
  currency: string,
  locale: string,
): string {
  const formatted = formatCurrency(Math.abs(value), currency, locale)
  if (value === 0) return formatted
  return `${value > 0 ? '+' : '−'}${formatted}`
}

export function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '—'
  const parsed = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return iso
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(parsed)
}

const COMMODITY = /^[A-Z][A-Z0-9._-]{0,15}$/

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Account paths show the Chinese leaf. Every other cell stays a BQL value. */
export function presentQueryCell(cell: unknown, locale: string): string {
  if (typeof cell === 'string' && cell.includes(':')) return displayAccountName(cell)
  return formatQueryValue(cell, locale)
}

/** One comparable value for a result column. Null sorts last. */
export function querySortValue(cell: unknown): number | string | null {
  if (cell == null || cell === '') return null
  if (typeof cell === 'number') return cell
  if (typeof cell === 'boolean') return cell ? 1 : 0
  if (typeof cell === 'string') return cell
  if (Array.isArray(cell)) {
    return cell.map((item) => querySortValue(item) ?? '').join('\u0000')
  }
  if (typeof cell === 'object') {
    const record = cell as Record<string, unknown>
    if (record.units != null && typeof record.units === 'object') {
      return querySortValue(record.units)
    }
    const amount = finiteNumber(record.number)
    if (amount != null && typeof record.currency === 'string') return amount
    const entries = Object.entries(record)
    if (entries.length !== 1) return null
    const [code, value] = entries[0]
    const figure = finiteNumber(value)
    if (figure != null && COMMODITY.test(code)) return figure
  }
  return null
}

/**
 * Render one BQL cell for a person reading the books.
 * Inventories and amounts become currency. Plain numbers stay numbers.
 * Structured engine objects are not printed as JSON.
 */
export function formatQueryValue(cell: unknown, locale: string): string {
  if (cell == null || cell === '') return '—'
  if (typeof cell === 'number') {
    if (Number.isInteger(cell)) {
      return formatNumber(cell, locale, { maximumFractionDigits: 0, useGrouping: false })
    }
    return formatNumber(cell, locale, { maximumFractionDigits: 2 })
  }
  if (typeof cell === 'string' || typeof cell === 'boolean') return String(cell)
  if (Array.isArray(cell)) {
    const parts = cell
      .map((item) => formatQueryValue(item, locale))
      .filter((part) => part !== '—')
    return parts.length > 0 ? parts.join(', ') : '—'
  }
  if (typeof cell === 'object') {
    const record = cell as Record<string, unknown>
    if (record.units != null && typeof record.units === 'object') {
      return formatQueryValue(record.units, locale)
    }
    const amount = finiteNumber(record.number)
    if (amount != null && typeof record.currency === 'string') {
      return formatCurrency(amount, record.currency, locale)
    }
    const parts: string[] = []
    for (const [code, value] of Object.entries(record)) {
      const figure = finiteNumber(value)
      if (!COMMODITY.test(code) || figure == null) return '—'
      parts.push(formatCurrency(figure, code, locale))
    }
    if (parts.length > 0) return parts.join(', ')
  }
  return '—'
}
