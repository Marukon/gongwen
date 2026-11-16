import type { GongwenAST, ParagraphAlignment, RichTextRun } from '../types/ast'
import { parseParsedLines } from './parser'
import { normalizeFontName } from '../utils/fontAliases'

interface ParsedRichLine {
  text: string
  lineNumber: number
  runs: RichTextRun[]
  alignment?: ParagraphAlignment
  noIndent?: boolean
}

function mergeAdjacentRuns(runs: RichTextRun[]): RichTextRun[] {
  const merged: RichTextRun[] = []

  for (const run of runs) {
    if (!run.text) continue
    const previous = merged[merged.length - 1]
    if (
      previous &&
      previous.bold === run.bold &&
      previous.italic === run.italic &&
      previous.underline === run.underline &&
      previous.fontFamily === run.fontFamily &&
      previous.fontSize === run.fontSize
    ) {
      previous.text += run.text
    } else {
      merged.push({ ...run })
    }
  }

  return merged
}

function parseFontSize(raw: string): number | undefined {
  const matched = raw.match(/(\d+(?:\.\d+)?)px/)
  if (matched) return Math.round(Number(matched[1]) * 72 / 96)
  const ptMatched = raw.match(/(\d+(?:\.\d+)?)pt/)
  if (ptMatched) return Number(ptMatched[1])
  return undefined
}

function parseTextAlign(raw: string | null): ParagraphAlignment | undefined {
  if (!raw) return undefined
  switch (raw) {
    case 'left':
    case 'center':
    case 'right':
    case 'justify':
      return raw
    default:
      return undefined
  }
}

// null 表示实际的 DOM 换行；源码里的空白字符仍按普通文本处理。
function extractRuns(node: Node, inherited: Omit<RichTextRun, 'text'> = {}): (RichTextRun | null)[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return [{ text: node.textContent?.replace(/\u00a0/g, ' ') ?? '', ...inherited }]
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return []

  const element = node as HTMLElement
  const nextStyle: Omit<RichTextRun, 'text'> = { ...inherited }
  const tagName = element.tagName

  if (tagName === 'B' || tagName === 'STRONG') nextStyle.bold = true
  if (tagName === 'I' || tagName === 'EM') nextStyle.italic = true
  if (tagName === 'U') nextStyle.underline = true

  const inlineStyle = element.style
  if (inlineStyle.fontWeight === 'bold' || Number(inlineStyle.fontWeight) >= 600) nextStyle.bold = true
  else if (inlineStyle.fontWeight === 'normal' || (inlineStyle.fontWeight && Number(inlineStyle.fontWeight) < 600)) nextStyle.bold = false
  if (inlineStyle.fontStyle === 'italic') nextStyle.italic = true
  else if (inlineStyle.fontStyle === 'normal') nextStyle.italic = false
  if (inlineStyle.textDecoration.includes('underline')) nextStyle.underline = true
  if (inlineStyle.fontFamily) {
    const rawFamily = inlineStyle.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
    nextStyle.fontFamily = normalizeFontName(rawFamily)
  }
  if (inlineStyle.fontSize) nextStyle.fontSize = parseFontSize(inlineStyle.fontSize)

  if (tagName === 'FONT') {
    const face = element.getAttribute('face')
    if (face) nextStyle.fontFamily = normalizeFontName(face)
  }

  if (tagName === 'BR') return [null]

  const result: (RichTextRun | null)[] = []
  let previousWasBlock = false
  for (const child of Array.from(element.childNodes)) {
    const runs = extractRuns(child, nextStyle)
    if (!runs.length) continue
    const isBlock = child instanceof HTMLElement && /^(?:DIV|P|H[1-6])$/.test(child.tagName)
    if ((isBlock || previousWasBlock) && result.length && result[result.length - 1] !== null) result.push(null)
    for (const run of runs) result.push(run)
    previousWasBlock = isBlock
  }
  return result
}

function extractBlocks(root: HTMLElement): ParsedRichLine[] {
  const blocks: ParsedRichLine[] = []
  let lineNumber = 1

  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const element = child as HTMLElement
      const alignment = parseTextAlign(element.style.textAlign || element.getAttribute('align'))
      const noIndent = element.dataset.noIndent === 'true'
      const lines: RichTextRun[][] = [[]]
      for (const run of extractRuns(element)) {
        if (run === null) lines.push([])
        else lines[lines.length - 1].push(run)
      }
      // 浏览器常在末尾插一个 BR 占位；显式连续换行仍保留。
      if (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop()
      for (const line of lines) {
        const runs = mergeAdjacentRuns(line)
        blocks.push({
          text: runs.map((run) => run.text).join(''),
          lineNumber: lineNumber++,
          runs,
          alignment,
          noIndent,
        })
      }
      continue
    }

    if (child.nodeType === Node.TEXT_NODE) {
      const rawText = child.textContent?.replace(/\u00a0/g, ' ') ?? ''
      if (rawText.trim().length > 0) {
        blocks.push({
          text: rawText,
          lineNumber,
          runs: [{ text: rawText }],
        })
        lineNumber++
      }
    }
  }

  return blocks
}

export function parseRichGongwen(html: string): GongwenAST {
  if (typeof DOMParser === 'undefined') {
    return parseParsedLines(
      html.split('\n').map((line, index) => ({
        text: line,
        lineNumber: index + 1,
        runs: [{ text: line }],
      })),
    )
  }

  const doc = new DOMParser().parseFromString(`<div data-editor-root="true">${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild as HTMLElement | null
  if (!root) return { title: null, body: [] }
  return parseParsedLines(extractBlocks(root), true)
}
