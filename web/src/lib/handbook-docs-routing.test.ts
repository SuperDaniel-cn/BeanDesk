import { describe, expect, test } from 'bun:test'

import { rewriteDocsDirectoryRequest } from './handbook-docs-routing'

describe('docs directory index', () => {
  test('rewrites handbook folders to index.html and leaves assets alone', () => {
    expect(rewriteDocsDirectoryRequest('/docs/')).toBe('/docs/index.html')
    expect(rewriteDocsDirectoryRequest('/docs/zh-CN/')).toBe('/docs/zh-CN/index.html')
    expect(rewriteDocsDirectoryRequest('/docs/setup/first-book/?from=sidebar')).toBe(
      '/docs/setup/first-book/index.html?from=sidebar',
    )
    expect(rewriteDocsDirectoryRequest('/docs/index.html')).toBe('/docs/index.html')
    expect(rewriteDocsDirectoryRequest('/docs/_next/app.js')).toBe('/docs/_next/app.js')
    expect(rewriteDocsDirectoryRequest('/docs/../../package.json')).toBe('/docs/../../package.json')
  })
})
