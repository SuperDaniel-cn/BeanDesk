import { afterEach, describe, expect, test } from 'bun:test'

import type { MessageKey } from '@/i18n/locales/en'
import { en } from '@/i18n/locales/en'
import { zhCN } from '@/i18n/locales/zh-CN'
import { readLedgerSlug } from './config'
import { FavaClient, isAirPlayServer } from './fava-client'
import {
  explainFavaError,
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
