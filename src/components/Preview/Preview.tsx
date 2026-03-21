import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties, type KeyboardEvent } from 'react'
import { useDocumentConfig } from '../../contexts/DocumentConfigContext'
import { CHARS_PER_LINE, FONT_OPTIONS, FONT_SIZE_OPTIONS, cmToPagePercent } from '../../types/documentConfig'
import { normalizeEditorHtml } from '../../utils/richText'
import './A4Page.css'
import './Preview.css'

interface PreviewProps {
  value: string
  onChange: (value: string) => void
}

const FONT_FAMILY_OPTIONS = FONT_OPTIONS.map((option) => option.value)
const FONT_SIZE_OPTIONS_CN = FONT_SIZE_OPTIONS.map((option) => ({
  label: option.label,
  value: option.value,
}))
const BLOCK_SELECTOR = 'p,div,h1,h2,h3,h4,h5,h6'

function applyStyles(element: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
  for (const [key, value] of Object.entries(styles)) {
    if (!value) continue
    const cssName = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
    element.style.setProperty(cssName, value)
  }
}

function styleNode(node: Node, styles: Partial<CSSStyleDeclaration>): Node {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? ''
    if (!text) return node.cloneNode(true)

    const span = document.createElement('span')
    applyStyles(span, styles)
    span.textContent = text
    return span
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return node.cloneNode(true)
  }

  const element = node as HTMLElement
  const clone = element.cloneNode(false) as HTMLElement
  if (clone.tagName !== 'BR') {
    applyStyles(clone, styles)
  }

  for (const child of Array.from(element.childNodes)) {
    clone.appendChild(styleNode(child, styles))
  }

  return clone
}

function applyInlineStyles(styles: Partial<CSSStyleDeclaration>) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return

  const range = selection.getRangeAt(0)
  const fragment = range.extractContents()
  const styledFragment = document.createDocumentFragment()

  for (const child of Array.from(fragment.childNodes)) {
    styledFragment.appendChild(styleNode(child, styles))
  }

  const insertedNodes = Array.from(styledFragment.childNodes)
  range.insertNode(styledFragment)
  if (insertedNodes.length === 0) return

  const nextRange = document.createRange()
  nextRange.setStartBefore(insertedNodes[0])
  nextRange.setEndAfter(insertedNodes[insertedNodes.length - 1])
  selection.removeAllRanges()
  selection.addRange(nextRange)
}

function isRangeInsideEditor(range: Range, editor: HTMLElement) {
  const startNode = range.startContainer
  const endNode = range.endContainer
  return editor.contains(startNode) && editor.contains(endNode)
}

function getHeaderOrgFontSize(orgName: string, leftMargin: number, rightMargin: number): number {
  const length = Math.max(1, Array.from(orgName.trim()).length)
  const availablePx = 595 * (1 - (leftMargin * 10 / 210) - (rightMargin * 10 / 210))
  return Math.max(18, Math.min(30, Math.floor(availablePx / length)))
}

function getSelectedBlocks(root: HTMLElement): HTMLElement[] {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return []

  const range = selection.getRangeAt(0)
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))
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

export function Preview({ value, onChange }: PreviewProps) {
  const { config } = useDocumentConfig()
  const editorRef = useRef<HTMLDivElement>(null)
  const syncingRef = useRef(false)
  const savedRangeRef = useRef<Range | null>(null)
  const [currentFont, setCurrentFont] = useState(FONT_FAMILY_OPTIONS[0])
  const [currentFontSize, setCurrentFontSize] = useState(FONT_SIZE_OPTIONS_CN[3]?.value ?? 16)
  const headerOrgFontSize = useMemo(
    () => getHeaderOrgFontSize(config.header.orgName, config.margins.left, config.margins.right),
    [config.header.orgName, config.margins.left, config.margins.right],
  )
  const headerOrgChars = useMemo(
    () => Array.from(config.header.orgName.trim()),
    [config.header.orgName],
  )

  const cssVars = useMemo((): CSSProperties => {
    const pageWidthPx = 595
    const marginLeftPct = config.margins.left * 10 / 210
    const marginRightPct = config.margins.right * 10 / 210
    const availablePx = pageWidthPx * (1 - marginLeftPct - marginRightPct)
    const charSpacingPx = availablePx / CHARS_PER_LINE - config.body.fontSize

    return {
      '--margin-top': `${cmToPagePercent(config.margins.top, 'x')}%`,
      '--margin-bottom': `${cmToPagePercent(config.margins.bottom, 'x')}%`,
      '--margin-left': `${cmToPagePercent(config.margins.left, 'x')}%`,
      '--margin-right': `${cmToPagePercent(config.margins.right, 'x')}%`,
      '--margin-bottom-y': `${cmToPagePercent(config.margins.bottom, 'y')}%`,
      '--title-font': config.title.fontFamily,
      '--title-size': `${config.title.fontSize}pt`,
      '--title-line-height': `${config.title.lineSpacing}pt`,
      '--body-font': config.body.fontFamily,
      '--body-size': `${config.body.fontSize}pt`,
      '--body-line-height': `${config.body.lineSpacing}pt`,
      '--body-indent': `${config.body.firstLineIndent}em`,
      '--char-spacing': `${charSpacingPx.toFixed(4)}px`,
      '--h1-font': config.headings.h1.fontFamily,
      '--h1-size': `${config.headings.h1.fontSize}pt`,
      '--h2-font': config.headings.h2.fontFamily,
      '--h2-size': `${config.headings.h2.fontSize}pt`,
      '--h3-font': config.advanced.h3.fontFamily,
      '--page-number-font': config.specialOptions.pageNumberFont,
    } as CSSProperties
  }, [config])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const normalized = normalizeEditorHtml(value)
    if (editor.innerHTML === normalized) return
    syncingRef.current = true
    editor.innerHTML = normalized
    syncingRef.current = false
  }, [value])

  const saveSelection = useCallback(() => {
    const editor = editorRef.current
    const selection = window.getSelection()
    if (!editor || !selection || selection.rangeCount === 0) return

    const range = selection.getRangeAt(0)
    if (!isRangeInsideEditor(range, editor)) return
    savedRangeRef.current = range.cloneRange()
  }, [])

  const restoreSelection = useCallback(() => {
    const editor = editorRef.current
    const selection = window.getSelection()
    const savedRange = savedRangeRef.current
    if (!editor || !selection || !savedRange) return false
    if (!isRangeInsideEditor(savedRange, editor)) return false

    editor.focus()
    selection.removeAllRanges()
    selection.addRange(savedRange.cloneRange())
    return true
  }, [])

  useEffect(() => {
    const handleSelectionChange = () => {
      saveSelection()
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [saveSelection])

  const emitChange = useCallback(() => {
    const editor = editorRef.current
    if (!editor || syncingRef.current) return
    onChange(normalizeEditorHtml(editor.innerHTML))
  }, [onChange])

  const handleFontChange = useCallback((fontFamily: string) => {
    setCurrentFont(fontFamily)
    restoreSelection()
    applyInlineStyles({ fontFamily })
    saveSelection()
    emitChange()
  }, [emitChange, restoreSelection, saveSelection])

  const handleFontSizeChange = useCallback((fontSize: number) => {
    setCurrentFontSize(fontSize)
    restoreSelection()
    applyInlineStyles({ fontSize: `${fontSize}pt` })
    saveSelection()
    emitChange()
  }, [emitChange, restoreSelection, saveSelection])

  const handleInlineStyle = useCallback((command: 'bold' | 'italic' | 'underline') => {
    restoreSelection()
    if (command === 'bold') applyInlineStyles({ fontWeight: 'bold' })
    if (command === 'italic') applyInlineStyles({ fontStyle: 'italic' })
    if (command === 'underline') applyInlineStyles({ textDecoration: 'underline' })
    saveSelection()
    emitChange()
  }, [emitChange, restoreSelection, saveSelection])

  const handleAlignmentChange = useCallback((alignment: 'left' | 'center' | 'right' | 'justify') => {
    const editor = editorRef.current
    if (!editor) return

    restoreSelection()
    const blocks = getSelectedBlocks(editor)
    if (blocks.length === 0) return

    for (const block of blocks) {
      block.style.textAlign = alignment
      if (alignment === 'justify') {
        if (block.dataset.alignNoIndent === 'true') {
          delete block.dataset.alignNoIndent
          delete block.dataset.noIndent
        }
      } else {
        block.dataset.noIndent = 'true'
        block.dataset.alignNoIndent = 'true'
      }
    }

    emitChange()
  }, [emitChange, restoreSelection])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Backspace') return

    const selection = window.getSelection()
    if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return

    const range = selection.getRangeAt(0)
    const block = (range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer as HTMLElement
      : range.startContainer.parentElement
    )?.closest('p')

    if (!block || block.dataset.noIndent === 'true') return

    const blockRange = document.createRange()
    blockRange.selectNodeContents(block)
    blockRange.setEnd(range.startContainer, range.startOffset)
    const textBeforeCaret = blockRange.toString()

    if (textBeforeCaret.length === 0) {
      block.dataset.noIndent = 'true'
      emitChange()
      e.preventDefault()
    }
  }, [emitChange])

  return (
    <div className="preview-container">
      <div className="preview-header">
        <div className="preview-header-main">
          <span className="preview-label">排版</span>
        </div>
        <div className="preview-toolbar">
          <select className="preview-select" value={currentFont} onMouseDown={saveSelection} onChange={(e) => handleFontChange(e.target.value)}>
            {FONT_FAMILY_OPTIONS.map((font) => (
              <option key={font} value={font}>{font}</option>
            ))}
          </select>
          <select className="preview-select preview-select--size" value={currentFontSize} onMouseDown={saveSelection} onChange={(e) => handleFontSizeChange(Number(e.target.value))}>
            {FONT_SIZE_OPTIONS_CN.map((option) => (
              <option key={option.label} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button type="button" className="preview-tool-btn" onMouseDown={saveSelection} onClick={() => handleInlineStyle('bold')}><strong>B</strong></button>
          <button type="button" className="preview-tool-btn" onMouseDown={saveSelection} onClick={() => handleInlineStyle('italic')}><em>I</em></button>
          <button type="button" className="preview-tool-btn" onMouseDown={saveSelection} onClick={() => handleInlineStyle('underline')}><u>U</u></button>
          <button type="button" className="preview-tool-btn" onClick={() => handleAlignmentChange('left')}>左</button>
          <button type="button" className="preview-tool-btn" onClick={() => handleAlignmentChange('center')}>中</button>
          <button type="button" className="preview-tool-btn" onClick={() => handleAlignmentChange('right')}>右</button>
          <button type="button" className="preview-tool-btn" onClick={() => handleAlignmentChange('justify')}>两端</button>
        </div>
      </div>
      <div className="preview-scroll" style={cssVars}>
        <div className="preview-page-shell">
          <div className="preview-page-content a4-content">
            {config.header.enabled && config.header.orgName && (
              <div className={`preview-header-section ${config.header.mode === 'note' ? 'preview-header-section--note' : ''}`}>
                <div className="a4-header-org" style={{ fontSize: `${headerOrgFontSize}pt` }}>
                  {headerOrgChars.map((char, index) => (
                    <span key={`${char}-${index}`} className="a4-header-org-char">
                      {char === ' ' ? '\u00a0' : char}
                    </span>
                  ))}
                </div>
                {config.header.mode === 'formal' && (config.header.docNumber || config.header.signer) && (
                  <div className={`a4-header-meta${config.header.signer ? ' a4-header-meta--with-signer' : ''}`}>
                    <span>{config.header.docNumber}</span>
                    {config.header.signer && (
                      <span>
                        <span className="a4-header-signer-label">签发人：</span>
                        <span className="a4-header-signer-name">{config.header.signer}</span>
                      </span>
                    )}
                  </div>
                )}
                <div className="a4-header-separator"></div>
              </div>
            )}
            <div
              ref={editorRef}
              className="preview-editor"
              contentEditable
              suppressContentEditableWarning
              onInput={emitChange}
              onBlur={emitChange}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
