import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import {
  HANDBOOK_WINDOW,
  HANDBOOK_WINDOW_SIZE,
  handbookWindowUrl,
} from './handbook-window'

describe('handbook window', () => {
  test('opens the bundled Fumadocs export at the main window size', () => {
    const tauri = JSON.parse(
      readFileSync(join(import.meta.dir, '../../../src-tauri/tauri.conf.json'), 'utf8'),
    ) as { app: { windows: Array<{ width: number; height: number; minWidth: number; minHeight: number }> } }
    const main = tauri.app.windows[0]
    expect(main.width).toBe(HANDBOOK_WINDOW_SIZE.width)
    expect(main.height).toBe(HANDBOOK_WINDOW_SIZE.height)
    expect(main.minWidth).toBe(HANDBOOK_WINDOW_SIZE.minWidth)
    expect(main.minHeight).toBe(HANDBOOK_WINDOW_SIZE.minHeight)
    expect(HANDBOOK_WINDOW_SIZE.resizable).toBe(true)
    expect(handbookWindowUrl('en')).toBe('/docs/index.html')
    expect(handbookWindowUrl('zh-CN')).toBe('/docs/zh-CN/index.html')
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
