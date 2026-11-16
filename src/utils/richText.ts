import type { GongwenAST, DocumentNode, AttachmentNode, RichTextRun } from '../types/ast'
import DOMPurify from 'dompurify'
import { getTitleLines, NodeType } from '../types/ast'
import type { DocumentConfig } from '../types/documentConfig'
import type { AutoFixResult, TextFixOptions } from './sanitize'
import { autoFixDocumentText } from './sanitize'
import { ensureTitleDateParentheses, getTitleMetadataIndices, readTitleByline } from './documentDates'
import { getHeadingSpans, headingClass, sliceHeadingText } from '../parser/headings'
import { attachmentClass, hasRichStyleOverrides, offsetTransform, readOffset } from './editorLayout'
import { paragraphIndentCss, readParagraphIndent } from './documentLayout'

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
const EDITOR_STYLES = new Set([
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration',
  'text-decoration-line', 'text-align', 'color',
])

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

export function parseEditorContent(html: string): HTMLDivElement {
  const root = document.createElement('div')
  const content = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: [...Array.from(BLOCK_TAGS, (tag) => tag.toLowerCase()), '#text', 'br', 'span', 'strong', 'em', 'b', 'i', 'u', 'font'],
    ALLOWED_ATTR: ['class', 'style', 'align', 'face', 'size', 'color', 'data-no-indent', 'data-align-no-indent', 'data-offset-chars', 'data-paragraph-indent-twips', 'data-relative-center-inset'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  })
  for (const element of content.querySelectorAll<HTMLElement>('[style]')) {
    for (const property of Array.from(element.style)) {
      if (!EDITOR_STYLES.has(property)) element.style.removeProperty(property)
    }
    if (!element.style.length) element.removeAttribute('style')
  }
  for (const element of content.querySelectorAll<HTMLElement>('[data-offset-chars]')) {
    const offset = readOffset(element.dataset.offsetChars)
    if (offset !== undefined && BLOCK_TAGS.has(element.tagName)) element.style.transform = offsetTransform(offset) ?? ''
    else delete element.dataset.offsetChars
  }
  for (const element of content.querySelectorAll<HTMLElement>('[data-paragraph-indent-twips]')) {
    const indent = paragraphIndentCss(readParagraphIndent(element.dataset.paragraphIndentTwips))
    if (indent && BLOCK_TAGS.has(element.tagName)) {
      Object.assign(element.style, indent)
      delete element.dataset.offsetChars
      element.style.removeProperty('transform')
    } else {
      delete element.dataset.paragraphIndentTwips
    }
  }
  root.append(content)

  const children = Array.from(root.childNodes)
  // Wrap any orphan inline nodes or text nodes directly under root into <p>
  let currentP: HTMLElement | null = null
  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((child as Element).tagName)) {
      currentP = null
      continue
    }

    if (child.nodeType === Node.TEXT_NODE && !child.textContent?.trim()) {
      continue
    }

    if (!currentP) {
      currentP = document.createElement('p')
      root.insertBefore(currentP, child)
    }
    currentP.appendChild(child)
  }

  if (!root.firstElementChild) {
    root.replaceChildren()
    root.appendChild(document.createElement('p')).append(document.createElement('br'))
  }
  return root
}

export function normalizeEditorHtml(html: string): string {
  if (typeof document === 'undefined') return plainTextToEditorHtml(html)
  return parseEditorContent(html).innerHTML
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

function renderBoldFirstSentence(text: string): string {
  const idx = text.indexOf('。')
  if (idx === -1 || idx === text.length - 1) {
    return `<strong>${escapeHtml(text)}</strong>`
  }

  const firstSentence = text.slice(0, idx + 1)
  const rest = text.slice(idx + 1)
  return `<strong>${escapeHtml(firstSentence)}</strong>${escapeHtml(rest)}`
}

function runsToHtml(runs: RichTextRun[]): string {
  return runs.map((run) => {
    const styles: string[] = []
    if (run.fontFamily) styles.push(`font-family:${run.fontFamily}`)
    if (run.fontSize) styles.push(`font-size:${run.fontSize}pt`)
    if (run.bold !== undefined) styles.push(run.bold ? 'font-weight:bold' : 'font-weight:normal')
    if (run.italic !== undefined) styles.push(run.italic ? 'font-style:italic' : 'font-style:normal')
    if (run.underline !== undefined) styles.push(run.underline ? 'text-decoration:underline' : 'text-decoration:none')
    if (run.color) styles.push(`color:#${run.color}`)
    return styles.length ? `<span style="${escapeAttribute(styles.join(';'))}">${escapeHtml(run.text)}</span>` : escapeHtml(run.text)
  }).join('')
}

function paragraphHtml(
  node: DocumentNode,
  className: string,
  boldFirstSentence = false,
  boldHeading3 = true
): string {
  const alignmentStyle = node.alignment ? ` style="text-align:${escapeAttribute(node.alignment)}"` : ''
  const noIndentAttr = node.noIndent ? ' data-no-indent="true"' : ''
  const offsetAttr = node.offsetChars ? ` data-offset-chars="${node.offsetChars}"` : ''
  const indentAttr = node.paragraphIndentTwips === undefined ? '' : ` data-paragraph-indent-twips="${node.paragraphIndentTwips}"`
  const styledRuns = hasRichStyleOverrides(node.runs) ? node.runs : undefined

  let content = '<br>'
  if (node.content) {
    const spans = getHeadingSpans(node.content, node.type)
    if (spans.length > 0) {
      content = sliceHeadingText(node.content, spans, styledRuns).map(({ text, type, runs }) => (
        `<span class="${type ? headingClass(type, boldHeading3) : 'a4-paragraph-inline'}">${runs ? runsToHtml(runs) : escapeHtml(text)}</span>`
      )).join('')
    } else if (styledRuns) {
      content = runsToHtml(styledRuns)
    } else if (boldFirstSentence) {
      content = renderBoldFirstSentence(node.content)
    } else {
      content = escapeHtml(node.content)
    }
  }
  return `<p class="${className}"${alignmentStyle}${noIndentAttr}${offsetAttr}${indentAttr}>${content}</p>`
}

function attachmentHtml(node: AttachmentNode): string {
  if (node.layoutLine) return paragraphHtml(node, attachmentClass(node.layoutLine))
  if (!node.isMultiple) {
    return `<p class="a4-attachment a4-attachment--single">附件：${escapeHtml(node.items[0]?.name ?? '')}</p>`
  }

  const [first, ...rest] = node.items
  return [
    `<p class="a4-attachment a4-attachment--multi-first">附件：${first.index}.${escapeHtml(first.name)}</p>`,
    ...rest.map((item) => `<p class="a4-attachment-item a4-attachment-item--multi">${item.index}.${escapeHtml(item.name)}</p>`),
  ].join('')
}

export function astToStyledHtml(ast: GongwenAST, config: DocumentConfig): string {
  const html: string[] = []
  const titleMetadata = getTitleMetadataIndices(ast, config.specialOptions.hasTitleNameDate)
  const firstBodyParagraphIndex = ast.body.findIndex((node, index) => (
    node.type === NodeType.PARAGRAPH && node.content.trim() !== '' &&
    index !== titleMetadata.name && index !== titleMetadata.date && index !== titleMetadata.byline
  ))

  if (ast.title) {
    getTitleLines(ast.title).forEach((line) => {
      html.push(paragraphHtml(line, 'a4-title'))
    })
    if (ast.body.length > 0) {
      if (titleMetadata.name < 0 && titleMetadata.byline === undefined && ast.body[0].content !== '') {
        html.push('<p><br></p>')
      }
    }
  }

  ast.body.forEach((node, index) => {
    if (node.type === NodeType.ATTACHMENT) {
      html.push(attachmentHtml(node as AttachmentNode))
      return
    }

    if (index === titleMetadata.name) {
      html.push(paragraphHtml(node, 'a4-title-secondary'))
      return
    }

    if (index === titleMetadata.date || index === titleMetadata.byline) {
      const dateContent = !hasRichStyleOverrides(node.runs)
        ? readTitleByline(node.content) ?? ensureTitleDateParentheses(node.content)
        : node.content
      html.push(paragraphHtml({ ...node, content: dateContent }, 'a4-title-date'))
      return
    }

    if (node.type === NodeType.SIGNATURE && !ast.layoutEditable) {
      html.push(...Array.from({ length: config.specialOptions.hasStamp ? 3 : 1 }, () => '<p><br></p>'))
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
