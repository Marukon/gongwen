import { NodeType, type GongwenAST, type ParagraphAlignment, type RichTextRun } from '../types/ast'
import { parseParsedLines, type ParsedLineInput } from './parser'
import { normalizeFontName } from '../utils/fontAliases'
import { readOffset } from '../utils/editorLayout'

let colorContext: CanvasRenderingContext2D | null | undefined

function parseColor(raw: string): string | undefined {
  if (!raw || !CSS.supports('color', raw) || raw === 'currentcolor') return undefined
  colorContext ??= document.createElement('canvas').getContext('2d')
  if (!colorContext) return undefined
  colorContext.fillStyle = raw
  const normalized = colorContext.fillStyle
  if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized.slice(1).toUpperCase()
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(normalized)
  if (!rgba) return undefined
  const alpha = Number(rgba[4])
  return rgba.slice(1, 4).map((channel) =>
    Math.round(255 * (1 - alpha) + Number(channel) * alpha).toString(16).padStart(2, '0'),
  ).join('').toUpperCase()
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
      previous.fontSize === run.fontSize &&
      previous.color === run.color
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
  if (matched) return Number(matched[1]) * 72 / 96
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

function readInlineStyle(element: HTMLElement, inherited: Omit<RichTextRun, 'text'>): Omit<RichTextRun, 'text'> {
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
  const decoration = inlineStyle.textDecorationLine || inlineStyle.textDecoration
  if (decoration.includes('underline')) nextStyle.underline = true
  else if (decoration === 'none') nextStyle.underline = false
  const color = parseColor(inlineStyle.color || element.getAttribute('color') || '')
  if (color) nextStyle.color = color
  if (inlineStyle.fontFamily) {
    const rawFamily = inlineStyle.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
    nextStyle.fontFamily = normalizeFontName(rawFamily)
  }
  if (inlineStyle.fontSize) nextStyle.fontSize = parseFontSize(inlineStyle.fontSize)

  if (tagName === 'FONT') {
    const face = element.getAttribute('face')
    if (face) nextStyle.fontFamily = normalizeFontName(face)
    const size = element.getAttribute('size')
    if (!inlineStyle.fontSize && size && /^[1-7]$/.test(size)) {
      nextStyle.fontSize = [8, 10, 12, 14, 18, 24, 36][Number(size) - 1]
    }
  }
  return nextStyle
}

function isBlock(element: Node): element is HTMLElement {
  return element instanceof HTMLElement && /^(?:DIV|P|H[1-6])$/.test(element.tagName)
}

// null 表示实际的 DOM 换行；源码里的空白字符仍按普通文本处理。
function extractRuns(node: Node, inherited: Omit<RichTextRun, 'text'> = {}): (RichTextRun | null)[] {
  if (node.nodeType === Node.TEXT_NODE) return [{ text: node.textContent ?? '', ...inherited }]
  if (!(node instanceof HTMLElement)) return []
  if (node.tagName === 'BR') return [null]
  const nextStyle = readInlineStyle(node, inherited)

  const result: (RichTextRun | null)[] = []
  let previousWasBlock = false
  for (const child of Array.from(node.childNodes)) {
    const runs = extractRuns(child, nextStyle)
    if (!runs.length) continue
    const childIsBlock = isBlock(child)
    if ((childIsBlock || previousWasBlock) && result.length && result[result.length - 1] !== null) result.push(null)
    for (const run of runs) result.push(run)
    previousWasBlock = childIsBlock
  }
  return result
}

function getLayoutHint(element: HTMLElement): Pick<ParsedLineInput, 'layoutType' | 'bylineRole' | 'attachmentLine'> {
  const classes = element.classList
  if (classes.contains('a4-title')) return { layoutType: NodeType.DOCUMENT_TITLE }
  if (classes.contains('a4-title-secondary')) return { bylineRole: 'name' }
  if (classes.contains('a4-title-date')) return { bylineRole: 'date' }
  if (classes.contains('a4-signature')) return { layoutType: NodeType.SIGNATURE }
  if (classes.contains('a4-date')) return { layoutType: NodeType.DATE }
  if (classes.contains('a4-addressee')) return { layoutType: NodeType.ADDRESSEE }
  if (classes.contains('a4-attachment--multi-first')) return { attachmentLine: 'first' }
  if (classes.contains('a4-attachment-item--multi')) return { attachmentLine: 'item' }
  if (classes.contains('a4-attachment--single')) return { attachmentLine: 'single' }
  return {}
}

function extractBlocks(root: HTMLElement): ParsedLineInput[] {
  const blocks: ParsedLineInput[] = []
  let lineNumber = 1
  function appendBlock(
    element: HTMLElement,
    inheritedStyles: Omit<RichTextRun, 'text'> = {},
    inheritedAlignment?: ParagraphAlignment,
  ) {
    const alignment = parseTextAlign(element.style.textAlign || element.getAttribute('align')) ?? inheritedAlignment
    const noIndent = element.dataset.noIndent === 'true'
    const offsetChars = readOffset(element.dataset.offsetChars)
    const hint = getLayoutHint(element)
    const nested = Array.from(element.children).some(isBlock)
    const styles = readInlineStyle(element, inheritedStyles)
    let pending: (RichTextRun | null)[] = []
    let firstLine = true
    function flush() {
      const lines: RichTextRun[][] = [[]]
      for (const run of pending) {
        if (run === null) lines.push([])
        else lines[lines.length - 1].push(run)
      }
      // 浏览器常在末尾插一个 BR 占位；显式连续换行仍保留。
      if (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop()
      for (const line of lines) {
        const runs = mergeAdjacentRuns(line)
        blocks.push({ text: runs.map((run) => run.text).join(''), lineNumber: lineNumber++, runs,
          alignment, noIndent, offsetChars, ...(firstLine ? hint : {}) })
        firstLine = false
      }
      pending = []
    }
    for (const child of Array.from(element.childNodes)) {
      if (isBlock(child)) {
        if (pending.length) flush()
        appendBlock(child, styles, alignment)
        firstLine = false
      } else {
        if (nested && child.nodeType === Node.TEXT_NODE && !child.textContent?.trim()) continue
        for (const run of extractRuns(child, styles)) pending.push(run)
      }
    }
    if (pending.length || firstLine) flush()
  }

  for (const child of Array.from(root.childNodes)) {
    if (child instanceof HTMLElement) {
      if (child.tagName === 'BR') blocks.push({ text: '', lineNumber: lineNumber++ })
      else appendBlock(child)
      continue
    }

    if (child.nodeType === Node.TEXT_NODE) {
      const rawText = child.textContent ?? ''
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
  const explicitLayout = !!root.querySelector('.a4-title,.a4-title-secondary,.a4-title-date,.a4-paragraph,.a4-signature,.a4-date,.a4-addressee,.a4-attachment,.a4-attachment-item,.a4-h1,.a4-h2,.a4-h3,.a4-h4')
  return parseParsedLines(extractBlocks(root), true, explicitLayout)
}
