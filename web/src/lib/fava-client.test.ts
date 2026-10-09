import { afterEach, describe, expect, test } from 'bun:test'

import type { MessageKey } from '@/i18n/locales/en'
import { en } from '@/i18n/locales/en'
import { zhCN } from '@/i18n/locales/zh-CN'
import { readLedgerSlug } from './config'
import { FavaClient, isAirPlayServer, parseLedgerData } from './fava-client'
import {
  explainFavaError,
  FAVA_LEDGER_DATA,
  FAVA_SLUG,
  FAVA_SLUG_INVALID,
  FAVA_UNREACHABLE,
} from './fava-error'

function catalogueKey(key: MessageKey): string {
  return key
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  delete (globalThis as { window?: unknown }).window
})

describe('parseLedgerData', () => {
  test('rejects a missing or empty payload instead of throwing later', () => {
    expect(() => parseLedgerData(null)).toThrow(FAVA_LEDGER_DATA)
    expect(() => parseLedgerData({})).toThrow(FAVA_LEDGER_DATA)
  })

  test('reads a Fava ledger_data body', () => {
    const ledger = parseLedgerData({
      accounts: ['Assets:Cash'],
      options: { title: 'Ledger', operating_currency: ['CNY'] },
    })
    expect(ledger.options.title).toBe('Ledger')
    expect(ledger.options.operating_currency).toEqual(['CNY'])
    expect(ledger.accounts).toEqual(['Assets:Cash'])
  })
})

describe('isAirPlayServer', () => {
  test('recognizes the macOS receiver that shares port 5000', () => {
    expect(isAirPlayServer('AirTunes/980.77.5')).toBe(true)
    expect(isAirPlayServer('AirPlay')).toBe(true)
    expect(isAirPlayServer('Cheroot/10.0.1')).toBe(false)
    expect(isAirPlayServer('')).toBe(false)
  })
})

describe('explainFavaError', () => {
  test('translates the client codes', () => {
    expect(explainFavaError(new Error(FAVA_UNREACHABLE), catalogueKey)).toBe('fava.unreachable')
    expect(explainFavaError(new Error(FAVA_SLUG), catalogueKey)).toBe('fava.slug')
    expect(explainFavaError(new Error(FAVA_SLUG_INVALID), catalogueKey)).toBe('fava.slugInvalid')
    expect(explainFavaError(new Error(FAVA_LEDGER_DATA), catalogueKey)).toBe('fava.ledgerData')
  })

  test('keeps an upstream message and falls back otherwise', () => {
    expect(explainFavaError(new Error('query failed'), catalogueKey)).toBe('query failed')
    expect(explainFavaError('nope', catalogueKey)).toBe('common.errorFallback')
    expect(explainFavaError('nope', catalogueKey, 'query.errorFallback')).toBe('query.errorFallback')
  })

  test('the catalogue actually translates the client errors', () => {
    expect(zhCN.fava.unreachable).not.toBe(en.fava.unreachable)
    expect(zhCN.fava.slug).not.toBe(en.fava.slug)
  })
})

describe('readLedgerSlug', () => {
  test('rejects a slug that is not a single path segment', () => {
    globalThis.window = { __APP_CONFIG__: { slug: 'my ledger' } } as Window & typeof globalThis
    expect(() => readLedgerSlug()).toThrow(FAVA_SLUG_INVALID)
  })
})

describe('FavaClient.ensureSlug', () => {
  test('reports that Fava cannot be reached', async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError('network'))) as unknown as typeof fetch
    const client = new FavaClient()
    await expect(client.ensureSlug()).rejects.toThrow(FAVA_UNREACHABLE)
  })

  test('accepts the default slug when that ledger answers', async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      if (String(url).includes('/beancount/api/ledger_data')) {
        return new Response('{}', { status: 200 })
      }
      return new Response(null, { status: 404 })
    }) as unknown as typeof fetch
    const client = new FavaClient()
    expect(await client.ensureSlug()).toBe('beancount')
  })

  test('fails when neither the default slug nor the root redirect identifies a ledger', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch
    const client = new FavaClient()
    await expect(client.ensureSlug()).rejects.toThrow(FAVA_SLUG)
  })
})

describe('FavaClient.ledgerChanged', () => {
  function mockChanged(data: boolean) {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const href = String(url)
      if (href.includes('/beancount/api/ledger_data')) {
        return new Response('{}', { status: 200 })
      }
      if (href.includes('/beancount/api/changed')) {
        return new Response(JSON.stringify({ data }), { status: 200 })
      }
      return new Response(null, { status: 404 })
    }) as unknown as typeof fetch
  }

  test('is true only when Fava reports data true', async () => {
    for (const data of [true, false]) {
      mockChanged(data)
      expect(await new FavaClient().ledgerChanged()).toBe(data)
    }
  })
})

describe('FavaClient slug recovery', () => {
  function mockLiveSlug(live: () => string, seen: string[]) {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const href = String(url)
      seen.push(href)
      if (href === '/api/fava/') {
        return new Response(null, {
          status: 302,
          headers: { location: `http://127.0.0.1:5000/${live()}/` },
        })
      }
      const match = href.match(/\/api\/fava\/([^/]+)\/api\//)
      const requestSlug = match?.[1]
      if (requestSlug !== live()) {
        return new Response(null, { status: 404, statusText: 'Not Found' })
      }
      if (href.includes('/api/ledger_data')) {
        return new Response(JSON.stringify({ data: { accounts: [] } }), { status: 200 })
      }
      if (href.includes('/api/changed')) {
        return new Response(JSON.stringify({ data: false }), { status: 200 })
      }
      return new Response(null, { status: 404, statusText: 'Not Found' })
    }) as unknown as typeof fetch
  }

  test('re-discovers after a later 404 and treats it as a change', async () => {
    let live = 'beancount'
    const seen: string[] = []
    mockLiveSlug(() => live, seen)
    const client = new FavaClient()
    expect(await client.ensureSlug()).toBe('beancount')
    live = 'books'
    expect(await client.ledgerChanged()).toBe(true)
    expect(client.getSlug()).toBe('books')
    expect(seen).toContain('/api/fava/')
    expect(seen.some((href) => href.includes('/books/api/changed'))).toBe(true)
  })

  test('does not rediscover when config.js pins the slug', async () => {
    globalThis.window = { __APP_CONFIG__: { slug: 'beancount' } } as Window & typeof globalThis
    const seen: string[] = []
    mockLiveSlug(() => 'books', seen)
    const client = new FavaClient()
    expect(await client.ensureSlug()).toBe('beancount')
    await expect(client.ledgerChanged()).rejects.toThrow('404 Not Found')
    expect(client.getSlug()).toBe('beancount')
    expect(seen).not.toContain('/api/fava/')
    expect(seen.every((href) => !href.includes('/books/'))).toBe(true)
  })
})
