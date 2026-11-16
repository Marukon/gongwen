import type { ParagraphAlignment } from '../../types/ast'
import { normalizeFontName } from '../../utils/fontAliases'
import { MAX_RELATIVE_OFFSET_CHARS, offsetTransform } from '../../utils/editorLayout'
import { getSignatureIndentChars } from '../../utils/documentLayout'

export const BLOCK_SELECTOR = 'p,div,h1,h2,h3,h4,h5,h6'

export function updateEditorSignatureLayout(editor: HTMLElement, hasStamp: boolean) {
  for (const block of editor.querySelectorAll<HTMLElement>(':scope > .a4-signature, :scope > .a4-date')) {
    const next = block.nextElementSibling
    const paired = block.classList.contains('a4-signature') && next?.classList.contains('a4-date')
    const raw = block.style.textAlign || block.getAttribute('align')
    const alignment = raw === 'left' || raw === 'right' || raw === 'center' || raw === 'justify' ? raw : undefined
    const indent = getSignatureIndentChars({
      hasStamp,
      name: paired ? block.textContent ?? '' : undefined,
      date: paired ? next?.textContent ?? '' : undefined,
      alignment,
      noIndent: block.dataset.noIndent === 'true',
    })
    block.style.setProperty('--signature-indent-chars', String(indent))
  }
}

export function exec(command: string, value?: string) {
  document.execCommand('styleWithCSS', false, 'true')
  document.execCommand(command, false, value)
}

function applyInlineStyleToRange(range: Range, format: Partial<CapturedFormat>) {
  const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentElement!
    : range.commonAncestorContainer

  const textNodes: Text[] = []
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      try {
        if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      } catch {
        return NodeFilter.FILTER_REJECT
      }
    },
  })

  let currentNode = walker.nextNode() as Text | null
  while (currentNode) {
    textNodes.push(currentNode)
    currentNode = walker.nextNode() as Text | null
  }

  if (textNodes.length === 0 && range.commonAncestorContainer.nodeType === Node.TEXT_NODE) {
    textNodes.push(range.commonAncestorContainer as Text)
  }

  const { startContainer, startOffset: rangeStart, endContainer, endOffset: rangeEnd } = range
  for (const textNode of textNodes) {
    const textVal = textNode.textContent ?? ''
    if (textVal.length === 0) continue

    let startOffset = 0
    let endOffset = textVal.length

    if (textNode === startContainer) {
      startOffset = rangeStart
    }
    if (textNode === endContainer) {
      endOffset = rangeEnd
    }

    if (startOffset >= endOffset) continue

    let targetNode = textNode
    if (startOffset > 0) {
      targetNode = textNode.splitText(startOffset)
      endOffset -= startOffset
    }
    if (endOffset < (targetNode.textContent?.length ?? 0)) {
      targetNode.splitText(endOffset)
    }

    const span = document.createElement('span')
    if (format.fontFamily) span.style.fontFamily = format.fontFamily
    if (format.fontSizePt) span.style.fontSize = `${format.fontSizePt}pt`
    if (format.bold !== undefined) span.style.fontWeight = format.bold ? 'bold' : 'normal'
    if (format.italic !== undefined) span.style.fontStyle = format.italic ? 'italic' : 'normal'
    if (format.underline) span.style.textDecoration = 'underline'
    if (format.color) span.style.color = format.color

    targetNode.parentNode?.insertBefore(span, targetNode)
    span.appendChild(targetNode)
  }
}

export function applyFontSize(editor: HTMLElement, size: number) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return

  const range = selection.getRangeAt(0)
  if (!editor.contains(range.commonAncestorContainer)) return
  applyInlineStyleToRange(range, { fontSizePt: size })
  selection.removeAllRanges()
}

export function getSelectedBlocks(root: HTMLElement): HTMLElement[] {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return []

  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return []
  const blocks = Array.from(root.children).filter((child): child is HTMLElement =>
    child instanceof HTMLElement && child.matches(BLOCK_SELECTOR))
  const selected = blocks.filter((block) => {
    try {
      return range.intersectsNode(block)
    } catch {
      return false
    }
  })

  if (selected.length > 0) return selected

  const startNode = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer as HTMLElement
    : range.startContainer.parentElement
  const fallback = startNode?.closest<HTMLElement>(BLOCK_SELECTOR)
  return fallback && root.contains(fallback) ? [fallback] : []
}

export function getRelativeCenterPair(editor: HTMLElement): [HTMLElement, HTMLElement] | undefined {
  const selection = window.getSelection()
  if (!selection?.rangeCount || selection.isCollapsed) return
  const selected = selection.getRangeAt(0)
  const blocks = getSelectedBlocks(editor).filter((block) => {
    if (block.parentElement !== editor) return false
    const portion = document.createRange()
    portion.selectNodeContents(block)
    if (block.contains(selected.startContainer)) portion.setStart(selected.startContainer, selected.startOffset)
    if (block.contains(selected.endContainer)) portion.setEnd(selected.endContainer, selected.endOffset)
    return portion.toString().trim() !== ''
  })
  if (blocks.length === 2) return [blocks[0], blocks[1]]
}

function getTextCenter(block: HTMLElement): number {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let found = false
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node as Text).data
    if (!text.trim()) continue
    if (!found) {
      range.setStart(node, text.length - text.trimStart().length)
      found = true
    }
    range.setEnd(node, text.trimEnd().length)
  }
  const { left, width } = range.getBoundingClientRect()
  return left + width / 2
}

export function setBlockOffset(block: HTMLElement, offset: number) {
  if (offset) block.dataset.offsetChars = String(offset)
  else delete block.dataset.offsetChars
  block.style.transform = offsetTransform(offset) ?? ''
}

function trimSignaturePadding(block: HTMLElement) {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    const leading = text.data.match(/^[\t \u00A0\u3000]+/)?.[0].length ?? 0
    if (leading) text.deleteData(0, leading)
    if (text.length) break
  }
}

export function centerBlockOnReference(
  [upper, lower]: [HTMLElement, HTMLElement], scaledBodyFontPx: number,
) {
  if (scaledBodyFontPx <= 0) return
  const targetCenter = getTextCenter(lower)
  const isSignature = upper.classList.contains('a4-signature')
  if (isSignature) trimSignaturePadding(upper)
  // Pin a signature and its date to the same axis in Word, even when date digits
  // have different widths there. The axis is the original position of the date.
  const signingPair = isSignature && lower.classList.contains('a4-date')
  for (const block of signingPair ? [lower, upper] : [upper]) {
    block.style.textAlign = 'center'
    block.dataset.noIndent = 'true'
    block.dataset.alignNoIndent = 'true'
    setBlockOffset(block, 0)
    const offset = Math.round((targetCenter - getTextCenter(block)) / scaledBodyFontPx * 100) / 100
    setBlockOffset(block, Math.max(-MAX_RELATIVE_OFFSET_CHARS, Math.min(MAX_RELATIVE_OFFSET_CHARS, offset)))
  }
}

export interface CapturedFormat {
  fontFamily?: string
  fontSizePt?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  textAlign?: ParagraphAlignment
}

export function getFormatAtSelection(editor: HTMLElement): CapturedFormat | null {
  const sel = window.getSelection()
  let targetElement: HTMLElement | null = null

  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0)
    let node: Node | null = range.startContainer
    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentElement
    }
    if (node && editor.contains(node)) {
      targetElement = node as HTMLElement
    }
  }

  if (!targetElement) {
    targetElement = editor.querySelector<HTMLElement>(BLOCK_SELECTOR) || editor
  }

  const computed = window.getComputedStyle(targetElement)
  const block = targetElement.closest<HTMLElement>(BLOCK_SELECTOR) || targetElement
  const blockComputed = window.getComputedStyle(block)

  let fontFamily = targetElement.style.fontFamily || block.style.fontFamily
  if (!fontFamily) {
    const rawFont = computed.fontFamily || blockComputed.fontFamily
    fontFamily = rawFont.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
  }
  fontFamily = normalizeFontName(fontFamily)

  let fontSizePt: number | undefined
  const rawFontSize = targetElement.style.fontSize || block.style.fontSize || computed.fontSize
  if (rawFontSize) {
    if (rawFontSize.includes('pt')) {
      fontSizePt = parseFloat(rawFontSize)
    } else if (rawFontSize.includes('px')) {
      fontSizePt = Math.round(parseFloat(rawFontSize) * 72 / 96)
    }
  }

  const bold = computed.fontWeight === 'bold' || parseInt(computed.fontWeight, 10) >= 600
  const italic = computed.fontStyle === 'italic'

  const isUnderlineTag = targetElement.closest('u') !== null
  const underline = isUnderlineTag || computed.textDecoration.includes('underline')

  const textAlign = (block.style.textAlign || blockComputed.textAlign) as ParagraphAlignment

  return {
    fontFamily,
    fontSizePt,
    bold,
    italic,
    underline,
    color: targetElement.style.color || computed.color,
    textAlign,
  }
}

export function applyFormatToSelection(editor: HTMLElement, format: CapturedFormat) {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
  let range = sel.getRangeAt(0)
  if (!editor.contains(range.commonAncestorContainer)) return
  if (format.underline === false) {
    if (!document.queryCommandState('underline')) exec('underline')
    if (document.queryCommandState('underline')) exec('underline')
    if (!sel.rangeCount || sel.isCollapsed) return
    range = sel.getRangeAt(0)
  }

  const blocks = getSelectedBlocks(editor)
  applyInlineStyleToRange(range, format)
  if (format.textAlign && blocks.length > 0) {
    for (const b of blocks) {
      b.style.textAlign = format.textAlign
      if (format.textAlign === 'justify') {
        delete b.dataset.alignNoIndent
        delete b.dataset.noIndent
      } else {
        b.dataset.noIndent = 'true'
        b.dataset.alignNoIndent = 'true'
      }
    }
  }
}

export function applyFormatToBlock(block: HTMLElement, format: CapturedFormat) {
  if (format.textAlign) {
    block.style.textAlign = format.textAlign
    if (format.textAlign === 'justify') {
      delete block.dataset.alignNoIndent
      delete block.dataset.noIndent
    } else {
      block.dataset.noIndent = 'true'
      block.dataset.alignNoIndent = 'true'
    }
  }

  if (format.fontFamily) {
    block.style.fontFamily = format.fontFamily
  }
  if (format.fontSizePt) {
    block.style.fontSize = `${format.fontSizePt}pt`
  }
  if (format.bold !== undefined) {
    block.style.fontWeight = format.bold ? 'bold' : 'normal'
  }
  if (format.italic !== undefined) {
    block.style.fontStyle = format.italic ? 'italic' : 'normal'
  }
  if (format.underline !== undefined) {
    block.style.textDecoration = format.underline ? 'underline' : 'none'
  }
  if (format.color) {
    block.style.color = format.color
  }

  for (const child of Array.from(block.querySelectorAll<HTMLElement>('span, strong, em, b, i, u'))) {
    if (format.fontFamily) child.style.fontFamily = format.fontFamily
    if (format.fontSizePt) child.style.fontSize = `${format.fontSizePt}pt`
    if (format.bold !== undefined) child.style.fontWeight = format.bold ? 'bold' : 'normal'
    if (format.italic !== undefined) child.style.fontStyle = format.italic ? 'italic' : 'normal'
    if (format.underline !== undefined) child.style.textDecoration = format.underline ? 'underline' : 'none'
    if (format.color) child.style.color = format.color
  }
}
