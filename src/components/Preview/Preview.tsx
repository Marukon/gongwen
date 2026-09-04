import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties, type KeyboardEvent } from 'react'
import { useDocumentConfig } from '../../contexts/useDocumentConfig'
import { CHARS_PER_LINE, FONT_OPTIONS, FONT_SIZE_OPTIONS, cmToPagePercent, A4_RENDER_WIDTH_PX, A4_RENDER_HEIGHT_PX } from '../../types/documentConfig'
import type { ParagraphAlignment } from '../../types/ast'
import { normalizeEditorHtml } from '../../utils/richText'
import { normalizeFontName } from '../../utils/fontAliases'
import { useDocumentParser } from '../../hooks/useDocumentParser'
import { useFitScale } from '../../hooks/useFitScale'
import { PrintPreview } from './PrintPreview'
import { renderA4FooterNote, getSignatureIndents } from './A4Page'
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

function exec(command: string, value?: string) {
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

  for (const textNode of textNodes) {
    const textVal = textNode.textContent ?? ''
    if (textVal.length === 0) continue

    let startOffset = 0
    let endOffset = textVal.length

    if (textNode === range.startContainer) {
      startOffset = range.startOffset
    }
    if (textNode === range.endContainer) {
      endOffset = range.endOffset
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
    if (format.bold) span.style.fontWeight = 'bold'
    if (format.italic) span.style.fontStyle = 'italic'
    if (format.underline) span.style.textDecoration = 'underline'
    if (format.color) span.style.color = format.color

    targetNode.parentNode?.insertBefore(span, targetNode)
    span.appendChild(targetNode)
  }
}

function applyFontSize(size: number) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return

  const range = selection.getRangeAt(0)
  applyInlineStyleToRange(range, { fontSizePt: size })
  selection.removeAllRanges()
}

export function getHeaderOrgFontSize(orgName: string, leftMargin: number, rightMargin: number, isFormal: boolean): number {
  const baseLen = Math.max(1, Array.from(orgName.trim()).length)
  const length = isFormal ? baseLen + 2 : baseLen // 正式文件加"文件"两字
  const availablePx = A4_RENDER_WIDTH_PX * (1 - (leftMargin * 10 / 210) - (rightMargin * 10 / 210))
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

interface CapturedFormat {
  fontFamily?: string
  fontSizePt?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  textAlign?: ParagraphAlignment
  blockClassName?: string
}

function getFormatAtSelection(editor: HTMLElement): CapturedFormat | null {
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

  const isBoldTag = targetElement.closest('b, strong') !== null
  const isBoldWeight = computed.fontWeight === 'bold' || parseInt(computed.fontWeight, 10) >= 600
  const isH1 = block.classList.contains('a4-h1') || block.tagName === 'H1' || targetElement.classList.contains('a4-h1-inline')
  const isTitle = block.classList.contains('a4-title') || block.tagName === 'H1'
  const bold = isBoldTag || isBoldWeight || isH1 || isTitle

  const isItalicTag = targetElement.closest('i, em') !== null
  const italic = isItalicTag || computed.fontStyle === 'italic'

  const isUnderlineTag = targetElement.closest('u') !== null
  const underline = isUnderlineTag || computed.textDecoration.includes('underline')

  const textAlign = (block.style.textAlign || blockComputed.textAlign) as ParagraphAlignment

  const blockClassName = Array.from(block.classList).find((c) => c.startsWith('a4-')) || 'a4-paragraph'

  return {
    fontFamily,
    fontSizePt,
    bold,
    italic,
    underline,
    color: targetElement.style.color || computed.color,
    textAlign,
    blockClassName,
  }
}

function applyFormatToSelection(editor: HTMLElement, format: CapturedFormat) {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
  const range = sel.getRangeAt(0)
  if (!editor.contains(range.commonAncestorContainer)) return

  applyInlineStyleToRange(range, format)

  const blocks = getSelectedBlocks(editor)
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

function applyFormatToBlock(block: HTMLElement, format: CapturedFormat) {
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

  if (format.blockClassName) {
    block.className = format.blockClassName
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

export function Preview({ value, onChange }: PreviewProps) {
  const { config } = useDocumentConfig()
  const editorRef = useRef<HTMLDivElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const syncingRef = useRef(false)
  const painterClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [currentFont, setCurrentFont] = useState(FONT_FAMILY_OPTIONS[0])
  const [currentFontSize, setCurrentFontSize] = useState(FONT_SIZE_OPTIONS_CN[3]?.value ?? 16)
  const [showPrintPreview, setShowPrintPreview] = useState(true)
  const [painterState, setPainterState] = useState<{
    active: boolean
    persistent: boolean
    format: CapturedFormat | null
  }>({
    active: false,
    persistent: false,
    format: null,
  })
  // 打印预览所需的实时 AST（与导出使用同一解析管线）
  const ast = useDocumentParser(value)
  const [pageCount, setPageCount] = useState(0)
  // 编辑模式同样以真实 A4 尺寸渲染，再整体缩放适配
  const { frameRef: editFrameRef, scale: editScale } = useFitScale(A4_RENDER_WIDTH_PX)

  const isFormalHeader = config.header.mode === 'formal'
  const headerOrgFontSize = useMemo(
    () => getHeaderOrgFontSize(config.header.orgName, config.margins.left, config.margins.right, isFormalHeader),
    [config.header.orgName, config.margins.left, config.margins.right, isFormalHeader],
  )
  const headerOrgChars = useMemo(
    () => {
      const chars = config.header.orgName.trim().split('')
      if (isFormalHeader) chars.push('文', '件')
      return chars
    },
    [config.header.orgName, isFormalHeader],
  )

  const cssVars = useMemo((): CSSProperties => {
    const pageWidthPx = 595
    const marginLeftPx = (config.margins.left / 21) * pageWidthPx
    const marginRightPx = (config.margins.right / 21) * pageWidthPx
    const availablePx = pageWidthPx - marginLeftPx - marginRightPx
    const textWidth = config.body.fontSize * CHARS_PER_LINE
    const letterSpacingUnits = CHARS_PER_LINE - 1
    const charSpacingPx = (availablePx - textWidth) / letterSpacingUnits

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
      '--h1-font': config.advanced.h1.fontFamily,
      '--h1-size': `${config.advanced.h1.fontSize}pt`,
      '--h2-font': config.advanced.h2.fontFamily,
      '--h2-size': `${config.advanced.h2.fontSize}pt`,
      '--h3-font': config.advanced.h3.fontFamily,
      '--h3-size': `${config.advanced.h3.fontSize}pt`,
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
  }, [value, showPrintPreview])

  const emitChange = useCallback(() => {
    const editor = editorRef.current
    if (!editor || syncingRef.current) return
    onChange(normalizeEditorHtml(editor.innerHTML))
  }, [onChange])

  const handleFontChange = useCallback((fontFamily: string) => {
    setCurrentFont(fontFamily)
    exec('fontName', fontFamily)
    emitChange()
  }, [emitChange])

  const handleFontSizeChange = useCallback((fontSize: number) => {
    setCurrentFontSize(fontSize)
    applyFontSize(fontSize)
    emitChange()
  }, [emitChange])

  const handleAlignmentChange = useCallback((alignment: 'left' | 'center' | 'right' | 'justify') => {
    const editor = editorRef.current
    if (!editor) return

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
  }, [emitChange])

  useEffect(() => {
    if (showPrintPreview) {
      setPainterState({ active: false, persistent: false, format: null })
    }
  }, [showPrintPreview])

  useEffect(() => {
    if (!painterState.active) return
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPainterState({ active: false, persistent: false, format: null })
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [painterState.active])

  const handlePainterClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const editor = editorRef.current
    if (!editor) return

    if (painterState.active) {
      if (painterClickTimerRef.current) {
        clearTimeout(painterClickTimerRef.current)
        painterClickTimerRef.current = null
      }
      setPainterState({ active: false, persistent: false, format: null })
      return
    }

    const format = getFormatAtSelection(editor)
    if (!format) return

    if (e.detail === 1) {
      painterClickTimerRef.current = setTimeout(() => {
        setPainterState({ active: true, persistent: false, format })
      }, 220)
    } else if (e.detail === 2) {
      if (painterClickTimerRef.current) {
        clearTimeout(painterClickTimerRef.current)
        painterClickTimerRef.current = null
      }
      setPainterState({ active: true, persistent: true, format })
    }
  }, [painterState.active])

  const handleEditorMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!painterState.active || !painterState.format) return

    const editor = editorRef.current
    if (!editor) return

    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      applyFormatToSelection(editor, painterState.format)
    } else {
      const target = e.target as HTMLElement
      const block = target.closest<HTMLElement>(BLOCK_SELECTOR)
      if (block && editor.contains(block)) {
        applyFormatToBlock(block, painterState.format)
      }
    }

    emitChange()

    if (!painterState.persistent) {
      setPainterState({ active: false, persistent: false, format: null })
    }
  }, [painterState, emitChange])

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
        <div className="preview-header-top">
          <span className="preview-label">预览</span>
          {showPrintPreview && pageCount > 0 && (
            <span className="preview-hint">共 {pageCount} 页</span>
          )}
          <button
            type="button"
            className={`preview-toggle${showPrintPreview ? ' preview-toggle--active' : ''}`}
            onClick={() => setShowPrintPreview((v) => !v)}
          >
            {showPrintPreview ? '编辑' : '预览'}
          </button>
        </div>
        {!showPrintPreview && (
        <div className="preview-toolbar">
          <select className="preview-select" value={currentFont} onChange={(e) => handleFontChange(e.target.value)}>
            {FONT_FAMILY_OPTIONS.map((font) => (
              <option key={font} value={font}>{font}</option>
            ))}
          </select>
          <select className="preview-select preview-select--size" value={currentFontSize} onChange={(e) => handleFontSizeChange(Number(e.target.value))}>
            {FONT_SIZE_OPTIONS_CN.map((option) => (
              <option key={option.label} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button type="button" className="preview-tool-btn" onClick={() => { exec('bold'); emitChange() }}><strong>B</strong></button>
          <button type="button" className="preview-tool-btn" onClick={() => { exec('italic'); emitChange() }}><em>I</em></button>
          <button type="button" className="preview-tool-btn" onClick={() => { exec('underline'); emitChange() }}><u>U</u></button>
          <button
            type="button"
            className={`preview-tool-btn preview-tool-btn--painter${
              painterState.active ? ' preview-tool-btn--active' : ''
            }${painterState.persistent ? ' preview-tool-btn--persistent' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={handlePainterClick}
            title={
              painterState.active
                ? painterState.persistent
                  ? '格式刷已激活（连续模式，Esc 或再次点击退出）'
                  : '格式刷已激活（单次模式，Esc 或再次点击退出）'
                : '格式刷（单击单次使用，双击连续使用，Esc 退出）'
            }
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ verticalAlign: '-2px', marginRight: '3px' }}>
              <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.5.5 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11z" />
            </svg>
            格式刷
          </button>
          <button type="button" className="preview-tool-btn" onClick={() => handleAlignmentChange('left')}>左</button>
          <button type="button" className="preview-tool-btn" onClick={() => handleAlignmentChange('center')}>中</button>
          <button type="button" className="preview-tool-btn" onClick={() => handleAlignmentChange('right')}>右</button>
          <button type="button" className="preview-tool-btn" onClick={() => handleAlignmentChange('justify')}>两端</button>
          {painterState.active && (
            <span className="preview-painter-badge">
              {painterState.persistent ? '连续刷格式中 (Esc退出)' : '刷格式中 (Esc退出)'}
            </span>
          )}
        </div>
        )}
      </div>
      <div className="preview-scroll" style={cssVars}>
        {showPrintPreview ? (
          <PrintPreview ast={ast} config={config} onPageCountChange={setPageCount} />
        ) : (
        <div
          className="preview-scale-frame"
          ref={editFrameRef}
          style={{ height: `${A4_RENDER_HEIGHT_PX * editScale}px` }}
        >
          <div className="preview-scale-content" style={{ transform: `scale(${editScale})` }}>
            <div className="preview-page-shell" ref={shellRef}>
              <div className="preview-page-paper">
                <div
                  className="preview-page-content a4-content">
                  {config.header.enabled && config.header.orgName && (
                    <div className={`preview-header-section ${config.header.mode === 'note' ? 'preview-header-section--note' : ''}`}>
                      <div className={`a4-header-org${isFormalHeader ? '' : ' a4-header-org--note'}`} style={{ fontSize: `${headerOrgFontSize}pt` }}>
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
                    className={`preview-editor${painterState.active ? ' preview-editor--painter' : ''}`}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={emitChange}
                    onBlur={emitChange}
                    onKeyDown={handleKeyDown}
                    onMouseUp={handleEditorMouseUp}
                  />
                </div>
                {renderA4FooterNote(config.footerNote)}
                {/* 落款：空三行，署名右空 4-5 字，日期居中于署名 */}
                {(config.specialOptions.signatureName || config.specialOptions.signatureDate) && (() => {
                  const dateS = (config.specialOptions.signatureDate || '').trim()
                  const nameS = (config.specialOptions.signatureName || '').trim()
                  const { nameIndentEm, dateIndentEm } = getSignatureIndents(nameS, dateS)
                  const lineStyle: CSSProperties = {
                    fontFamily: config.body.fontFamily,
                    fontSize: `${config.body.fontSize}pt`,
                    lineHeight: `${config.body.lineSpacing}pt`,
                    margin: 0,
                  }
                  return (
                    <div className="a4-signature-area">
                      {[0, 1, 2].map((j) => (
                        <p key={`sig-empty-${j}`} style={{ ...lineStyle, height: `${config.body.lineSpacing}pt` }}>{'\u00A0'}</p>
                      ))}
                      {nameS && (
                        <p style={{ ...lineStyle, textAlign: 'right', paddingRight: `${nameIndentEm}em` }}>
                          {nameS}
                        </p>
                      )}
                      {dateS && (
                        <p style={{ ...lineStyle, textAlign: 'right', paddingRight: `${dateIndentEm}em` }}>
                          {dateS}
                        </p>
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  )
}
