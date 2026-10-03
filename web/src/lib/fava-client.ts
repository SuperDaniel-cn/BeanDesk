/**
 * Native Fava API and BQL client.
 *
 * In the browser the prefix is `/api/fava`, which Vite or Caddy proxies to
 * Fava. The desktop shell sets a direct origin and sends those requests
 * through the Tauri HTTP plugin. The slug comes from `public/config.js` when
 * set. Otherwise the client probes the default slug and then the redirect
 * Fava sends from its root.
 */

import { apiUrl, readLedgerSlug } from './config'
import { FAVA_SLUG, FAVA_UNREACHABLE } from './fava-error'
import { assembleJournalRows, journalQuery, type JournalPage } from './journal'
import {
  operatingCurrency,
  quoteCommodity,
  responseLooksLikeFava,
  slugFromRedirectUrl,
} from './ledger-model'

export interface FavaAccountDetail {
  meta?: Record<string, unknown>
}

export interface FavaLedgerData {
  accounts: string[]
  /** Open-directive metadata, keyed by account. */
  account_details?: Record<string, FavaAccountDetail>
  currencies: string[]
  currency_names: Record<string, string>
  errors: Array<{ message: string; source?: { filename: string; lineno: number } }>
  options: {
    title: string
    operating_currency: string[]
    documents?: string[]
    name_assets?: string
    name_liabilities?: string
    name_equity?: string
    name_income?: string
    name_expenses?: string
  }
  tags: string[]
  payees: string[]
  years: Array<number | string>
}

export interface BQLQueryResult {
  types: Array<{ name: string; dtype: string }>
  rows: unknown[][]
}

export interface PostingItem {
  account: string
  amount: number
  currency: string
}

export interface LedgerDocument {
  filename: string
  account: string
  date: string
}

export interface TransactionEntry {
  id: string
  date: string
  flag: string
  payee: string
  narration: string
  postings: PostingItem[]
  tags: string[]
  links: string[]
}

const DEFAULT_SLUG = 'beancount'

export type OriginProbe =
  | { kind: 'fava' }
  | { kind: 'closed' }
  | { kind: 'occupied'; server: string }

export class FavaClient {
  private slug: string | null = null
  private slugResolved = false
  private inflightLedger: Promise<FavaLedgerData> | null = null
  private directOrigin: string | null = null

  /** Desktop shell only. Browser calls keep the `/api/fava` prefix. */
  useOrigin(origin: string | null) {
    this.directOrigin = origin
    this.slug = null
    this.slugResolved = false
    this.inflightLedger = null
  }

  getSlug() {
    return this.slug ?? (readLedgerSlug() || DEFAULT_SLUG)
  }

  private prefix(): string {
    return this.directOrigin ?? apiUrl('/api/fava')
  }

  /**
   * Distinguish a Fava redirect from a closed port and from another program
   * that merely answers HTTP. macOS AirPlay Receiver does the latter on 5000.
   */
  async probe(): Promise<OriginProbe> {
    let response: Response
    try {
      response = await this.request(`${this.prefix()}/`, { maxRedirections: 0 })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.toLowerCase().includes('not allowed')) throw error
      return { kind: 'closed' }
    }
    const server = response.headers.get('server') ?? ''
    const fava =
      response.status !== 0 &&
      responseLooksLikeFava(response.status, response.url || `${this.prefix()}/`, response.headers.get('location'))
    await response.arrayBuffer().catch(() => undefined)
    if (fava) return { kind: 'fava' }
    if (response.status === 0) return { kind: 'closed' }
    return { kind: 'occupied', server }
  }

  private async request(
    url: string,
    init?: RequestInit & { maxRedirections?: number },
  ): Promise<Response> {
    if (!this.directOrigin) return fetch(url, init)
    const { fetch: pluginFetch } = await import('@tauri-apps/plugin-http')
    return pluginFetch(url, init)
  }

  /**
   * Resolve the ledger slug. A configured slug is trusted. Otherwise a failed
   * probe is an error — the default name is not kept after a 404.
   */
  async ensureSlug(): Promise<string> {
    if (this.slugResolved && this.slug) return this.slug

    const configured = readLedgerSlug()
    if (configured) {
      this.slug = configured
      this.slugResolved = true
      return configured
    }

    const candidate = this.slug || DEFAULT_SLUG
    let probe: Response
    try {
      probe = await this.request(`${this.prefix()}/${candidate}/api/ledger_data`)
    } catch {
      throw new Error(FAVA_UNREACHABLE)
    }
    if (probe.ok) {
      this.slug = candidate
      this.slugResolved = true
      return candidate
    }

    let discovered: string | null = null
    try {
      const root = await this.request(
        `${this.prefix()}/`,
        this.directOrigin ? { maxRedirections: 0 } : undefined,
      )
      const base = root.url || `${this.prefix()}/`
      const location = root.headers.get('location')
      if (location) discovered = slugFromRedirectUrl(new URL(location, base).href)
      if (!discovered) discovered = slugFromRedirectUrl(base)
      await root.arrayBuffer().catch(() => undefined)
    } catch {
      discovered = null
    }
    if (discovered) {
      try {
        const check = await this.request(`${this.prefix()}/${discovered}/api/ledger_data`)
        if (check.ok) {
          this.slug = discovered
          this.slugResolved = true
          return discovered
        }
      } catch {
        // Fall through to the configuration error.
      }
    }

    throw new Error(FAVA_SLUG)
  }

  private async fetchJson(url: string, signal?: AbortSignal): Promise<{ data?: unknown; error?: string }> {
    const res = await this.request(url, { signal })
    const json = (await res.json().catch(() => null)) as { data?: unknown; error?: string } | null
    if (!res.ok) {
      const detail = json?.error ? String(json.error) : `${res.status} ${res.statusText}`
      throw new Error(detail)
    }
    return json ?? {}
  }

  async getLedgerData(signal?: AbortSignal): Promise<FavaLedgerData> {
    if (!this.inflightLedger) {
      this.inflightLedger = this.loadLedgerData().finally(() => {
        this.inflightLedger = null
      })
    }
    const data = await this.inflightLedger
    if (signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
    return data
  }

  private async loadLedgerData(): Promise<FavaLedgerData> {
    await this.ensureSlug()
    const json = await this.fetchJson(`${this.prefix()}/${this.slug}/api/ledger_data`)
    return json.data as FavaLedgerData
  }

  async query(bql: string, time?: string, signal?: AbortSignal): Promise<BQLQueryResult> {
    await this.ensureSlug()
    const params = new URLSearchParams({ query_string: bql })
    if (time) params.set('time', time)
    const json = await this.fetchJson(
      `${this.prefix()}/${this.slug}/api/query?${params}`,
      signal,
    )
    return (json.data ?? { types: [], rows: [] }) as BQLQueryResult
  }

  private reportUrl(endpoint: string, time?: string, conversion?: string): string {
    const params = new URLSearchParams()
    if (time) params.set('time', time)
    if (conversion) params.set('conversion', quoteCommodity(conversion))
    const query = params.toString()
    return `${this.prefix()}/${this.slug}/api/${endpoint}${query ? `?${query}` : ''}`
  }

  async getBalanceSheet(time?: string, conversion?: string, signal?: AbortSignal): Promise<unknown> {
    await this.ensureSlug()
    const json = await this.fetchJson(this.reportUrl('balance_sheet', time, conversion), signal)
    return json.data
  }

  async getIncomeStatement(time?: string, conversion?: string, signal?: AbortSignal): Promise<unknown> {
    await this.ensureSlug()
    const json = await this.fetchJson(this.reportUrl('income_statement', time, conversion), signal)
    return json.data
  }

  async getTrialBalance(time?: string, conversion?: string, signal?: AbortSignal): Promise<unknown> {
    await this.ensureSlug()
    const json = await this.fetchJson(this.reportUrl('trial_balance', time, conversion), signal)
    return json.data
  }

  getDocumentUrl(filename: string): string {
    return `${this.prefix()}/${this.getSlug()}/document/?filename=${encodeURIComponent(filename)}`
  }

  /** Bytes for an in-page preview. The desktop shell cannot use the raw URL in an image tag. */
  async readDocument(filename: string, signal?: AbortSignal): Promise<Blob> {
    await this.ensureSlug()
    const res = await this.request(this.getDocumentUrl(filename), { signal })
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`)
    }
    const header = res.headers.get('content-type')
    const bytes = await res.arrayBuffer()
    return new Blob([bytes], { type: documentType(filename, header) })
  }

  async getPostingYears(signal?: AbortSignal): Promise<string[]> {
    const result = await this.query('SELECT year GROUP BY year', undefined, signal)
    return (result.rows ?? []).map((row) => String(row[0])).sort((a, b) => b.localeCompare(a))
  }

  async getAccounts(): Promise<string[]> {
    const data = await this.getLedgerData()
    return data.accounts || []
  }

  async getDocuments(): Promise<LedgerDocument[]> {
    await this.ensureSlug()
    try {
      const json = await this.fetchJson(`${this.prefix()}/${this.slug}/api/documents`)
      return Array.isArray(json.data) ? (json.data as LedgerDocument[]) : []
    } catch {
      return []
    }
  }

  async getTransactions(time?: string): Promise<JournalPage> {
    const ledgerData = await this.getLedgerData()
    const currency = operatingCurrency(ledgerData.options.operating_currency)
    const result = await this.query(journalQuery(), time)
    return assembleJournalRows(result.rows ?? [], currency)
  }
}

function documentType(filename: string, header: string | null): string {
  if (header && !header.startsWith('application/octet-stream')) return header
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return header || 'application/octet-stream'
}

export const favaClient = new FavaClient()
