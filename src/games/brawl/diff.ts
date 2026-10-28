/** One line of a patch: kept, added or removed. */
export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string }

/** A line diff by longest common subsequence. Bot files are short, so the simple table is fine. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const rows = a.length + 1
  const cols = b.length + 1
  const lcs = new Array<number>(rows * cols).fill(0)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * cols + j] =
        a[i] === b[j]
          ? (lcs[(i + 1) * cols + j + 1] ?? 0) + 1
          : Math.max(lcs[(i + 1) * cols + j] ?? 0, lcs[i * cols + j + 1] ?? 0)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] ?? '' })
      i++
      j++
    } else if (
      j < b.length &&
      (i >= a.length || (lcs[i * cols + j + 1] ?? 0) >= (lcs[(i + 1) * cols + j] ?? 0))
    ) {
      out.push({ kind: 'add', text: b[j] ?? '' })
      j++
    } else {
      out.push({ kind: 'del', text: a[i] ?? '' })
      i++
    }
  }
  return out
}

export function diffStat(lines: DiffLine[]) {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.kind === 'add' && line.text.trim()) added++
    if (line.kind === 'del' && line.text.trim()) removed++
  }
  return { added, removed }
}
