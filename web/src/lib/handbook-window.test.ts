import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import {
  HANDBOOK_READY_EVENT,
  HANDBOOK_WINDOW,
  HANDBOOK_WINDOW_SIZE,
  handbookChrome,
  handbookWindowUrl,
} from './handbook-window'

describe('handbook window', () => {
  test('opens the bundled Fumadocs export at the main window size', () => {
    const tauri = JSON.parse(
      readFileSync(join(import.meta.dir, '../../../src-tauri/tauri.conf.json'), 'utf8'),
    ) as { app: { windows: Array<{ width: number; height: number; minWidth: number; minHeight: number; visible?: boolean }> } }
    const main = tauri.app.windows[0]
    expect(main.visible).toBe(false)
    expect(main.width).toBe(HANDBOOK_WINDOW_SIZE.width)
    expect(main.height).toBe(HANDBOOK_WINDOW_SIZE.height)
    expect(main.minWidth).toBe(HANDBOOK_WINDOW_SIZE.minWidth)
    expect(main.minHeight).toBe(HANDBOOK_WINDOW_SIZE.minHeight)
    expect(HANDBOOK_WINDOW_SIZE.resizable).toBe(true)
    expect(HANDBOOK_READY_EVENT).toBe('handbook-ready')
    expect(handbookWindowUrl('en', 'dark')).toBe('/docs/index.html?theme=dark')
    expect(handbookWindowUrl('zh-CN', 'light')).toBe('/docs/zh-CN/index.html?theme=light')
    expect(handbookChrome('dark')).toEqual({
      visible: false,
      theme: 'dark',
      backgroundColor: '#171717',
    })
    expect(handbookChrome('light')).toEqual({
      visible: false,
      theme: 'light',
      backgroundColor: '#ffffff',
    })
  })
})

describe('handbook window capability', () => {
  const capability = JSON.parse(
    readFileSync(join(import.meta.dir, '../../../src-tauri/capabilities/handbook.json'), 'utf8'),
  ) as { windows: string[]; permissions: string[] }

  test('loads the bundled site and nothing privileged', () => {
    expect(capability.windows).toEqual([HANDBOOK_WINDOW])
    expect(capability.permissions).toEqual(['core:default'])
  })
})

describe('main window handbook chrome', () => {
  const capability = JSON.parse(
    readFileSync(join(import.meta.dir, '../../../src-tauri/capabilities/default.json'), 'utf8'),
  ) as { permissions: Array<string | { identifier: string }> }

  test('can show a window that was created hidden', () => {
    const names = capability.permissions.filter((item): item is string => typeof item === 'string')
    expect(names).toContain('core:window:allow-show')
    expect(names).not.toContain('core:window:allow-hide')
  })
})
