export type DiffTag = 'eq' | 'del' | 'add'

export type DiffLine = {
  tag: DiffTag
  text: string
}

/** Line-oriented LCS unified diff. Empty sides become all deletions or additions. */
export function lineDiff(trusted: string | null, disk: string | null): DiffLine[] {
  const left = splitLines(trusted)
  const right = splitLines(disk)
  if (left === null) {
    return right?.map((text) => ({ tag: 'add' as const, text })) ?? []
  }
  if (right === null) {
    return left.map((text) => ({ tag: 'del', text }))
  }
  return lcsDiff(left, right)
}

function splitLines(value: string | null): string[] | null {
  if (value === null) return null
  return value.split('\n')
}

function lcsDiff(left: string[], right: string[]): DiffLine[] {
  const rows = left.length
  const cols = right.length
  const table: number[][] = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0))
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i][j] =
        left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < rows && j < cols) {
    if (left[i] === right[j]) {
      lines.push({ tag: 'eq', text: left[i] })
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ tag: 'del', text: left[i] })
      i += 1
    } else {
      lines.push({ tag: 'add', text: right[j] })
      j += 1
    }
  }
  while (i < rows) {
    lines.push({ tag: 'del', text: left[i] })
    i += 1
  }
  while (j < cols) {
    lines.push({ tag: 'add', text: right[j] })
    j += 1
  }
  return lines
}
