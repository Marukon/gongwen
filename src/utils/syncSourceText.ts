import diff from 'fast-diff'

/** Apply user edits in the layout's text coordinates to the source, retaining untouched original spelling and whitespace. */
export function syncSourceText(source: string, before: string, after: string): string {
  if (before === after) return source
  if (source === before || !after || !before) return after

  // A source-only gap (e.g. an extra blank line) has a left and a right boundary.
  const left = new Uint32Array(before.length + 1)
  const right = new Uint32Array(before.length + 1)
  let i = 0, j = 0
  const mapping = diff(before, source)
  for (let k = 0; k < mapping.length; k++) {
    const [kind, part] = mapping[k]
    if (kind === 0) {
      for (let n = 0; n < part.length; n++) { i++; j++; left[i] = right[i] = j }
      continue
    }
    let removed = 0, added = 0
    for (; k < mapping.length && mapping[k][0] !== 0; k++) {
      if (mapping[k][0] === -1) removed += mapping[k][1].length
      else added += mapping[k][1].length
    }
    k--
    for (let n = 1; n <= removed; n++) left[i+n] = right[i+n] = j + Math.round(n * added / removed)
    i += removed
    j += added
    right[i] = j
  }

  // Replacements share a boundary so a deleted character and its replacement stay together.
  const chunks: string[] = []
  let old = 0, copied = 0
  const changes = diff(before, after)
  for (let k = 0; k < changes.length; k++) {
    const [kind, part] = changes[k]
    if (kind === 0) { old += part.length; continue }
    const start = old
    let insertion = ''
    for (; k < changes.length && changes[k][0] !== 0; k++) {
      if (changes[k][0] === -1) old += changes[k][1].length
      else insertion += changes[k][1]
    }
    k--
    const from = right[start]
    chunks.push(source.slice(copied, from), insertion)
    copied = Math.max(from, left[old])
  }
  chunks.push(source.slice(copied))
  return chunks.join('')
}
