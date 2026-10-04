export function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export function formatCsv(meta: string[], headers: string[], rows: string[][]): string {
  return [
    ...meta.map((line) => `# ${line}`),
    headers.map(csvCell).join(','),
    ...rows.map((row) => row.map(csvCell).join(',')),
  ].join('\n')
}

export function csvFilename(parts: string[]): string {
  const slug = parts
    .map((part) => part.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('-')
  return `${slug || 'export'}.csv`
}

export function exportStatementCsv(input: {
  title: string
  currency: string
  periodLabel: string
  periodToken: string
  report: string
  headers: string[]
  rows: string[][]
}): void {
  downloadCsv(
    csvFilename([input.title, input.report, input.periodToken || 'all']),
    formatCsv(
      [input.title, input.currency, input.periodLabel, input.report],
      input.headers,
      input.rows,
    ),
  )
}

export function downloadCsv(filename: string, body: string): void {
  const url = URL.createObjectURL(new Blob([`\uFEFF${body}`], { type: 'text/csv;charset=utf-8;' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
