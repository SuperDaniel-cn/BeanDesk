const DOCS_DIRECTORY_PATH = /^\/docs(?:\/[A-Za-z0-9._-]+)*\/$/

export function rewriteDocsDirectoryRequest(url: string | undefined): string | undefined {
  if (!url) return url
  const queryIndex = url.indexOf('?')
  const pathname = queryIndex === -1 ? url : url.slice(0, queryIndex)
  if (!DOCS_DIRECTORY_PATH.test(pathname)) return url
  const query = queryIndex === -1 ? '' : url.slice(queryIndex)
  return `${pathname}index.html${query}`
}
