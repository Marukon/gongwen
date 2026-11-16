import { NodeType, type RichTextRun } from '../types/ast'

export type HeadingType = NodeType.HEADING_1 | NodeType.HEADING_2 | NodeType.HEADING_3 | NodeType.HEADING_4

const DIGITS = '一二三四五六七八九'
const TENS = '[' + DIGITS + ']?十[' + DIGITS + ']?'
const ORDINAL = '(?:[' + DIGITS + ']百(?:零[' + DIGITS + ']|' + TENS + ')?|' + TENS + '|[' + DIGITS + '])'
const CHINESE_MARKER = new RegExp('^' + ORDINAL + '\\s*、')
const CHINESE_PARENS = new RegExp('^[（(]\\s*' + ORDINAL + '\\s*[）)]')
const ARABIC_DOT = /^[0-9０-９]+[ \t\u3000]*[.．](?![0-9０-９])/
const ARABIC_PARENS = /^[（(][ \t\u3000]*[0-9０-９]+[ \t\u3000]*[）)]/
const DISCOURSE = new RegExp('^(' + ORDINAL + ')[ \\t\\u3000]*(是|要(?![素件点]))')
const ORDERED_CLAUSE = new RegExp('^第\\s*' + ORDINAL + '\\s*[，,]')

export function isHeading(type: NodeType): type is HeadingType {
  return type === NodeType.HEADING_1 || type === NodeType.HEADING_2 ||
    type === NodeType.HEADING_3 || type === NodeType.HEADING_4
}

export function isDiscourseHeading(text: string): boolean {
  const line = text.trimStart()
  return DISCOURSE.test(line) || ORDERED_CLAUSE.test(line)
}

export function detectHeading(text: string): HeadingType | null {
  const line = text.trimStart()
  if (CHINESE_MARKER.test(line)) return NodeType.HEADING_1
  if (CHINESE_PARENS.test(line)) return NodeType.HEADING_2
  if (ARABIC_DOT.test(line) || isDiscourseHeading(line)) return NodeType.HEADING_3
  if (ARABIC_PARENS.test(line)) return NodeType.HEADING_4
  return null
}

interface HeadingSpan {
  start: number
  end: number
  type: HeadingType
}

const CLOSING = new Map(Object.entries({
  '“': '”', '‘': '’', '「': '」', '『': '』', '《': '》', '〈': '〉',
  '（': '）', '(': ')', '【': '】', '[': ']',
}))

function topLevelMarks(text: string) {
  const stack: string[] = []
  const marks: { position: number; mark: string }[] = []
  for (let position = 0; position < text.length; position++) {
    const mark = text[position]
    const closing = CLOSING.get(mark)
    if (closing) stack.push(closing)
    else if (mark === stack[stack.length - 1]) stack.pop()
    else if (stack.length === 0 && /[：:；;。！？!?，,]/.test(mark)) marks.push({ position, mark })
  }
  return marks
}

function ordinalValue(text: string): number {
  let total = 0
  let digit = 0
  for (const char of text) {
    if (char === '百' || char === '十') {
      total += (digit || 1) * (char === '百' ? 100 : 10)
      digit = 0
    } else {
      digit = DIGITS.indexOf(char) + 1
    }
  }
  return total + digit
}

export function getHeadingSpans(text: string, type: NodeType): HeadingSpan[] {
  if (!isHeading(type) && (type !== NodeType.PARAGRAPH || !/[：:；;]/.test(text))) return []
  const marks = topLevelMarks(text)
  const spans: HeadingSpan[] = []
  // 正式标题止于句末或引出正文的冒号；语篇分项也可在分号处结束。
  const endings = marks.filter(({ mark }) => /[；;。！？!?]/.test(mark))
  const firstDiscourse = type === NodeType.HEADING_3 && isDiscourseHeading(text)
  if (isHeading(type)) {
    const first = firstDiscourse ? endings[0] : marks.find(({ mark, position }) => (
      /[：。！？!?]/.test(mark) || (mark === ':' && text[position + 1] !== '/')
    ))
    spans.push({ start: 0, end: first ? first.position + 1 : text.length, type })
  }

  // 段内分项需要同一语式和连续序号；引语、括号及孤立的「一是」保持原样。
  const candidates = [{ position: -1, mark: '' }, ...marks.filter(({ mark }) => /[：:；;，,]/.test(mark))]
  let group: { start: number; end: number; ordinal: number; verb: string }[] = []
  let endIndex = 0
  const flush = () => {
    if (group.length < 2) return
    const heading = spans[spans.length - 1]
    if (heading && group[0].start < heading.end) {
      if (group[0].start === heading.start) spans.pop()
      else if (group[0].start > heading.start) heading.end = group[0].start
    }
    for (const { start, end } of group) {
      if (start >= (spans[spans.length - 1]?.end ?? 0)) spans.push({ start, end, type: NodeType.HEADING_3 })
    }
  }
  for (const { position, mark } of candidates) {
    const offset = position + 1
    let start = offset
    while (start < text.length && /\s/.test(text[start])) start++
    // 用短前缀匹配，长段落里有大量标点时避免反复截取剩余全文。
    const match = DISCOURSE.exec(text.slice(start, start + 16))
    if (!match) continue
    while (endIndex < endings.length && endings[endIndex].position < start) endIndex++
    const end = endIndex < endings.length ? endings[endIndex].position + 1 : text.length
    if (end <= start + match[0].length) continue
    const item = { start, end, ordinal: ordinalValue(match[1]), verb: match[2] }
    const previous = group[group.length - 1]
    const commaContinues = /[，,]/.test(mark) && previous && previous.end > position
    if (previous && item.ordinal === previous.ordinal + 1 && item.verb === previous.verb &&
      (commaContinues || !text.slice(previous.end, item.start).trim() && previous.end <= item.start)) {
      previous.end = Math.min(previous.end, offset)
      group.push(item)
    } else {
      flush()
      group = item.ordinal === 1 && !/[，,]/.test(mark) ? [item] : []
    }
  }
  flush()
  return spans
}

export function sliceHeadingText(text: string, spans: HeadingSpan[], runs?: RichTextRun[]) {
  const result: { text: string; type?: HeadingType; runs?: RichTextRun[] }[] = []
  let cursor = 0
  for (const span of spans) {
    if (cursor < span.start) result.push({ text: text.slice(cursor, span.start) })
    result.push({ text: text.slice(span.start, span.end), type: span.type })
    cursor = span.end
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor) })
  if (runs?.length) {
    const source = runs.map((run) => run.text).join('')
    if (source.trim() !== text) return result
    let index = 0
    let offset = 0
    let skip = source.length - source.trimStart().length
    for (const part of result) {
      let remaining = part.text.length
      part.runs = []
      while (remaining > 0 && index < runs.length) {
        const run = runs[index]
        const discarded = Math.min(skip, run.text.length - offset)
        skip -= discarded
        offset += discarded
        const taken = Math.min(remaining, run.text.length - offset)
        if (taken) part.runs.push({ ...run, text: run.text.slice(offset, offset + taken) })
        remaining -= taken
        offset += taken
        if (offset === run.text.length) {
          index++
          offset = 0
        }
      }
    }
  }
  return result
}

export function headingClass(type: HeadingType, boldHeading3: boolean): string {
  if (type === NodeType.HEADING_1) return 'a4-h1-inline'
  if (type === NodeType.HEADING_2) return 'a4-h2-inline'
  if (type === NodeType.HEADING_4) return 'a4-h4-inline'
  return boldHeading3 ? 'a4-h3-inline a4-h3-inline--bold' : 'a4-h3-inline'
}
