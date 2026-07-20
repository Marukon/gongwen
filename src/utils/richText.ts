import type { GongwenAST, DocumentNode, AttachmentNode, RichTextRun } from '../types/ast'
import { NodeType } from '../types/ast'
import type { DocumentConfig } from '../types/documentConfig'
import type { AutoFixResult, TextFixOptions } from './sanitize'
import { autoFixDocumentText } from './sanitize'

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

function wrapHtml(html: string): string {
  return `<div data-editor-root="true">${html}</div>`
}

function createDocument(html: string): Document | null {
  if (typeof DOMParser === 'undefined') return null
  return new DOMParser().parseFromString(wrapHtml(html), 'text/html')
}

function getRoot(doc: Document | null): HTMLElement | null {
  return doc?.body.firstElementChild as HTMLElement | null
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function plainTextToEditorHtml(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')

  if (lines.length === 1 && lines[0] === '') {
    return '<p><br></p>'
  }

  return lines
    .map((line) => (line.length === 0 ? '<p><br></p>' : `<p>${escapeHtml(line)}</p>`))
    .join('')
}

export function normalizeEditorHtml(html: string): string {
  if (!html.trim()) return '<p><br></p>'

  const doc = createDocument(html)
  const root = getRoot(doc)
  if (!root) return plainTextToEditorHtml(html)

  const directBlockChildren = Array.from(root.childNodes).some((node) => (
    node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((node as Element).tagName)
  ))

  if (!directBlockChildren) {
    const text = root.textContent ?? ''
    return plainTextToEditorHtml(text)
  }

  if (root.innerHTML.trim() === '') return '<p><br></p>'
  return root.innerHTML
}

export function editorHtmlToPlainText(html: string): string {
  const doc = createDocument(html)
  const root = getRoot(doc)
  if (!root) return html

  const lines: string[] = []
  const children = Array.from(root.childNodes)
  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((child as Element).tagName)) {
      const text = (child.textContent ?? '').replace(/\u00a0/g, ' ')
      lines.push(text)
    } else if (child.nodeType === Node.TEXT_NODE) {
      lines.push((child.textContent ?? '').replace(/\u00a0/g, ' '))
    }
  }

  return lines.join('\n')
}

export function editorHtmlHasContent(html: string): boolean {
  return editorHtmlToPlainText(html).trim().length > 0
}

export function autoFixEditorHtml(html: string, options: TextFixOptions): AutoFixResult {
  const doc = createDocument(html)
  const root = getRoot(doc)
  if (!root) return autoFixDocumentText(html, options)

  let punctuationCount = 0
  let whitespaceCount = 0
  let lineBreakCount = 0

  const walker = doc!.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let currentNode = walker.nextNode()

  while (currentNode) {
    const original = currentNode.textContent ?? ''
    if (original.length > 0) {
      const fixed = autoFixDocumentText(original, options)
      currentNode.textContent = fixed.text
      punctuationCount += fixed.punctuationCount
      whitespaceCount += fixed.whitespaceCount
      lineBreakCount += fixed.lineBreakCount
    }
    currentNode = walker.nextNode()
  }

  return {
    text: normalizeEditorHtml(root.innerHTML),
    punctuationCount,
    whitespaceCount,
    lineBreakCount,
    count: punctuationCount + whitespaceCount + lineBreakCount,
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/"/g, '&quot;')
}

function hasRichStyleOverrides(runs?: RichTextRun[]): boolean {
  return !!runs?.some((run) => (
    run.bold ||
    run.italic ||
    run.underline ||
    !!run.fontFamily ||
    !!run.fontSize
  ))
}

function renderHeading1Html(content: string): string {
  const idx = content.indexOf('。')
  if (idx === -1 || idx === content.length - 1) {
    return `<span class="a4-h1-inline">${escapeHtml(content)}</span>`
  }
  return `<span class="a4-h1-inline">${escapeHtml(content.slice(0, idx + 1))}</span><span class="a4-paragraph-inline">${escapeHtml(content.slice(idx + 1))}</span>`
}

function renderHeading2Html(content: string): string {
  const idx = content.indexOf('。')
  if (idx === -1 || idx === content.length - 1) {
    return `<span class="a4-h2-inline">${escapeHtml(content)}</span>`
  }
  return `<span class="a4-h2-inline">${escapeHtml(content.slice(0, idx + 1))}</span><span class="a4-paragraph-inline">${escapeHtml(content.slice(idx + 1))}</span>`
}

function renderHeading3Html(content: string, bold = true): string {
  const headingClassName = bold ? 'a4-h3-inline a4-h3-inline--bold' : 'a4-h3-inline'
  const idx = content.indexOf('。')
  if (idx === -1 || idx === content.length - 1) {
    return `<span class="${headingClassName}">${escapeHtml(content)}</span>`
  }
  return `<span class="${headingClassName}">${escapeHtml(content.slice(0, idx + 1))}</span><span class="a4-paragraph-inline">${escapeHtml(content.slice(idx + 1))}</span>`
}

function renderHeading4Html(content: string): string {
  const idx = content.indexOf('。')
  if (idx === -1 || idx === content.length - 1) {
    return `<span class="a4-h4-inline">${escapeHtml(content)}</span>`
  }
  return `<span class="a4-h4-inline">${escapeHtml(content.slice(0, idx + 1))}</span><span class="a4-paragraph-inline">${escapeHtml(content.slice(idx + 1))}</span>`
}

function renderBoldFirstSentence(text: string): string {
  const idx = text.indexOf('。')
  if (idx === -1 || idx === text.length - 1) {
    return `<strong>${escapeHtml(text)}</strong>`
  }

  const firstSentence = text.slice(0, idx + 1)
  const rest = text.slice(idx + 1)
  return `<strong>${escapeHtml(firstSentence)}</strong>${escapeHtml(rest)}`
}

function paragraphHtml(
  node: DocumentNode,
  className: string,
  boldFirstSentence = false,
  boldHeading3 = true
): string {
  const alignmentStyle = node.alignment ? ` style="text-align:${escapeAttribute(node.alignment)}"` : ''
  const noIndentAttr = node.noIndent ? ' data-no-indent="true"' : ''
  if (node.runs && node.runs.length > 0 && hasRichStyleOverrides(node.runs)) {
    const runHtml = node.runs.map((run) => {
      const styles: string[] = []
      if (run.fontFamily) styles.push(`font-family:${run.fontFamily}`)
      if (run.fontSize) styles.push(`font-size:${run.fontSize}pt`)
      if (run.bold) styles.push('font-weight:bold')
      if (run.italic) styles.push('font-style:italic')
      if (run.underline) styles.push('text-decoration:underline')
      return `<span${styles.length > 0 ? ` style="${escapeAttribute(styles.join(';'))}"` : ''}>${escapeHtml(run.text)}</span>`
    }).join('')
    return `<p class="${className}"${alignmentStyle}${noIndentAttr}>${runHtml || '<br>'}</p>`
  }

  let content = '<br>'
  if (node.content) {
    if (node.type === NodeType.HEADING_1) {
      content = renderHeading1Html(node.content)
    } else if (node.type === NodeType.HEADING_2) {
      content = renderHeading2Html(node.content)
    } else if (node.type === NodeType.HEADING_3) {
      content = renderHeading3Html(node.content, boldHeading3)
    } else if (node.type === NodeType.HEADING_4) {
      content = renderHeading4Html(node.content)
    } else if (boldFirstSentence) {
      content = renderBoldFirstSentence(node.content)
    } else {
      content = escapeHtml(node.content)
    }
  }
  return `<p class="${className}"${alignmentStyle}${noIndentAttr}>${content}</p>`
}

function attachmentHtml(node: AttachmentNode): string {
  if (!node.isMultiple) {
    return `<p class="a4-attachment a4-attachment--single">附件：${escapeHtml(node.items[0]?.name ?? '')}</p>`
  }

  const [first, ...rest] = node.items
  return [
    `<p class="a4-attachment a4-attachment--multi-first">附件：${first.index}.${escapeHtml(first.name)}</p>`,
    ...rest.map((item) => `<p class="a4-attachment-item a4-attachment-item--multi">${item.index}.${escapeHtml(item.name)}</p>`),
  ].join('')
}

function isTitleDateNode(ast: GongwenAST, index: number, hasTitleNameDate = false): boolean {
  if (!ast.title) return false
  return hasTitleNameDate && index === 1
}

function isTitleNameNode(ast: GongwenAST, index: number, hasTitleNameDate = false): boolean {
  if (!ast.title || index !== 0) return false
  return hasTitleNameDate
}

/** 为标题下日期补全省份全角括号：已带括号则不处理，纯日期则包裹 */
function ensureTitleDateParentheses(content: string): string {
  const trimmed = content.trim()
  if (/^[（(]\d{4}年\d{1,2}月\d{1,2}日[）)]$/.test(trimmed)) return trimmed
  if (/^\d{4}年\d{1,2}月\d{1,2}日$/.test(trimmed)) return `（${trimmed}）`
  return content
}

function findFirstBodyParagraphIndex(ast: GongwenAST, hasTitleNameDate = false): number {
  return ast.body.findIndex((node, index) => (
    node.type === NodeType.PARAGRAPH &&
    node.content.trim() !== '' &&
    !isTitleNameNode(ast, index, hasTitleNameDate) &&
    !isTitleDateNode(ast, index, hasTitleNameDate)
  ))
}

export function astToStyledHtml(ast: GongwenAST, config: DocumentConfig): string {
  const html: string[] = []
  const hasTitleNameDate = config.specialOptions.hasTitleNameDate
  const firstBodyParagraphIndex = findFirstBodyParagraphIndex(ast, hasTitleNameDate)

  if (ast.title) {
    html.push(paragraphHtml(ast.title, 'a4-title'))
    if (ast.body.length > 0) {
      if (!isTitleNameNode(ast, 0, hasTitleNameDate) && !isTitleDateNode(ast, 0, hasTitleNameDate)) {
        html.push('<p><br></p>')
      }
    }
  }

  ast.body.forEach((node, index) => {
    if (node.type === NodeType.ATTACHMENT) {
      html.push(attachmentHtml(node as AttachmentNode))
      return
    }

    if (isTitleNameNode(ast, index, hasTitleNameDate)) {
      html.push(paragraphHtml(node, 'a4-title-secondary'))
      return
    }

    if (isTitleDateNode(ast, index, hasTitleNameDate)) {
      const dateContent = hasTitleNameDate && !hasRichStyleOverrides(node.runs)
        ? ensureTitleDateParentheses(node.content)
        : node.content
      html.push(paragraphHtml({ ...node, content: dateContent }, 'a4-title-date'))
      if (index + 1 < ast.body.length) {
        html.push('<p><br></p>')
      }
      return
    }

    const className = {
      [NodeType.DOCUMENT_TITLE]: 'a4-title',
      [NodeType.HEADING_1]: 'a4-h1',
      [NodeType.HEADING_2]: 'a4-h2',
      [NodeType.HEADING_3]: 'a4-h3',
      [NodeType.HEADING_4]: 'a4-h4',
      [NodeType.PARAGRAPH]: 'a4-paragraph',
      [NodeType.ADDRESSEE]: 'a4-addressee',
      [NodeType.ATTACHMENT]: 'a4-attachment',
      [NodeType.SIGNATURE]: 'a4-signature',
      [NodeType.DATE]: 'a4-date',
    }[node.type]

    const shouldNoIndent = node.noIndent || (
      config.specialOptions.firstParagraphNoIndent &&
      node.type === NodeType.PARAGRAPH &&
      index === firstBodyParagraphIndex
    )
    const shouldBoldFirstSentence = (
      config.specialOptions.boldFirstSentence &&
      node.type === NodeType.PARAGRAPH
    )
    const boldHeading3 = config.specialOptions.boldHeading3
    html.push(paragraphHtml({ ...node, noIndent: shouldNoIndent }, className, shouldBoldFirstSentence, boldHeading3))
  })

  return html.join('') || '<p><br></p>'
}
