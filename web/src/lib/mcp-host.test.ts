import { describe, expect, test } from 'bun:test'

import { en } from '@/i18n/locales/en'
import { zhCN } from '@/i18n/locales/zh-CN'

import { mcpHostConfigText } from './mcp-host'

const config = {
  command: '/Applications/BeanDesk.app/Contents/MacOS/BeanDesk',
  args: ['mcp'],
}

describe('mcp host config', () => {
  test('copies only the stdio command', () => {
    const text = mcpHostConfigText(config)
    expect(JSON.parse(text)).toEqual({
      command: config.command,
      args: ['mcp'],
    })
    expect(text).not.toContain('opc-ledger')
    expect(text).not.toContain('Cursor')
  })

  test('prompt copy stays host-neutral', () => {
    for (const text of [en.settings.mcpPrompt, zhCN.settings.mcpPrompt]) {
      expect(text).toContain('{command}')
      expect(text).toContain('{args}')
      expect(text).not.toContain('Cursor')
      expect(text).not.toContain('opc-ledger')
      expect(text).not.toContain('confirmWrite')
    }
  })
})
