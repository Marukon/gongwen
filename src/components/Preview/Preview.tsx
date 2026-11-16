import { useEffect, useMemo, useRef, useState, useCallback, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type RefObject } from 'react'
import { useDocumentConfig } from '../../contexts/useDocumentConfig'
import { CHARS_PER_LINE, FONT_OPTIONS, FONT_SIZE_OPTIONS, cmToPagePercent, A4_RENDER_WIDTH_PX, A4_RENDER_HEIGHT_PX } from '../../types/documentConfig'
import type { GongwenAST } from '../../types/ast'
import { normalizeEditorHtml, parseEditorContent } from '../../utils/richText'
import { BLOCK_SELECTOR, exec, applyFontSize, getSelectedBlocks, getFormatAtSelection, applyFormatToSelection, applyFormatToBlock, type CapturedFormat } from './layoutFormatting'
import { getSupplementalSignature } from '../../utils/documentDates'
import { MAX_OFFSET_CHARS, offsetTransform, readOffset } from '../../utils/editorLayout'
import { LayoutHistory } from '../../utils/layoutHistory'
import { insertLayoutParagraphs } from '../../utils/editorInsert'
import { useFitScale } from '../../hooks/useFitScale'
import { PrintPreview } from './PrintPreview'
import { renderA4FooterNote, getSignatureIndents } from './A4Page'
import './A4Page.css'
import './Preview.css'

interface PreviewProps {
  value: string
  ast: GongwenAST
  onChange: (value: string) => void
  editorRef: RefObject<HTMLDivElement | null>
}

const FONT_FAMILY_OPTIONS = FONT_OPTIONS.map((option) => option.value)
const FONT_SIZE_OPTIONS_CN = FONT_SIZE_OPTIONS.map((option) => ({
  label: option.label,
  value: option.value,
}))
export function getHeaderOrgFontSize(orgName: string, leftMargin: number, rightMargin: number, isFormal: boolean): number {
  const baseLen = Math.max(1, Array.from(orgName.trim()).length)
  const length = isFormal ? baseLen + 2 : baseLen // 正式文件加"文件"两字
  const availablePx = A4_RENDER_WIDTH_PX * (1 - (leftMargin * 10 / 210) - (rightMargin * 10 / 210))
  return Math.max(18, Math.min(30, Math.floor(availablePx / length)))
}

export function Preview({ value, ast, onChange, editorRef }: PreviewProps) {
  const { config } = useDocumentConfig()
  const shellRef = useRef<HTMLDivElement>(null)
  const lastEmittedRef = useRef<string | null>(null)
  const selectionRef = useRef<Range | null>(null)
  const internalDrag = useRef(false)
  const formattingBatch = useRef(false)
  const historyRef = useRef(new LayoutHistory())
  const composingRef = useRef(false)
  const [historyButtons, setHistoryButtons] = useState({ undo: false, redo: false })
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
  const [pageCount, setPageCount] = useState(0)
  const [editHeight, setEditHeight] = useState(A4_RENDER_HEIGHT_PX)
  // 编辑模式同样以真实 A4 尺寸渲染，再整体缩放适配
  const { frameRef: editFrameRef, scale: editScale } = useFitScale(A4_RENDER_WIDTH_PX, !showPrintPreview)
  const signature = getSupplementalSignature(ast, config.specialOptions)

  const updateHistoryButtons = useCallback(() => {
    const { canUndo, canRedo } = historyRef.current
    setHistoryButtons((state) => state.undo === canUndo && state.redo === canRedo
      ? state : { undo: canUndo, redo: canRedo })
  }, [])

  useEffect(() => {
    if (showPrintPreview || !shellRef.current) return
    const shell = shellRef.current
    const measure = () => setEditHeight(shell.offsetHeight)
    const observer = new ResizeObserver(measure)
    measure()
    observer.observe(shell)
    return () => observer.disconnect()
  }, [showPrintPreview])

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
    const pageWidthPx = A4_RENDER_WIDTH_PX
    const marginLeftPx = (config.margins.left / 21) * pageWidthPx
    const marginRightPx = (config.margins.right / 21) * pageWidthPx
    const availablePx = pageWidthPx - marginLeftPx - marginRightPx
    const textWidth = config.body.fontSize * (96 / 72) * CHARS_PER_LINE
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
      '--signature-indent': config.specialOptions.hasStamp ? '4em' : '2em',
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
    if (!editor) {
      lastEmittedRef.current = null
      selectionRef.current = null
      return
    }
    if (lastEmittedRef.current === value) return
    const content = parseEditorContent(value)
    if (historyRef.current.present?.html !== content.innerHTML) {
      historyRef.current.reset({ html: content.innerHTML })
      updateHistoryButtons()
    }
    if (editor.innerHTML !== content.innerHTML) editor.replaceChildren(...content.childNodes)
    lastEmittedRef.current = value
  }, [value, showPrintPreview, editorRef, updateHistoryButtons])

  useEffect(() => {
    if (showPrintPreview) return
    const rememberSelection = () => {
      const editor = editorRef.current
      const selection = window.getSelection()
      if (!editor || !selection?.rangeCount) return
      const range = selection.getRangeAt(0)
      if (editor.contains(range.commonAncestorContainer)) selectionRef.current = range.cloneRange()
    }
    const clearOutsideSelection = (event: PointerEvent) => {
      historyRef.current.breakTyping()
      const target = event.target
      if (target instanceof Element && !editorRef.current?.contains(target) && !target.closest('.preview-toolbar,.preview-history')) {
        selectionRef.current = null
      }
    }
    document.addEventListener('selectionchange', rememberSelection)
    document.addEventListener('pointerdown', clearOutsideSelection)
    return () => {
      document.removeEventListener('selectionchange', rememberSelection)
      document.removeEventListener('pointerdown', clearOutsideSelection)
    }
  }, [showPrintPreview, editorRef])

  const restoreSelection = useCallback(() => {
    const editor = editorRef.current
    const selection = window.getSelection()
    if (!editor || !selection) return false
    const current = selection.rangeCount ? selection.getRangeAt(0) : null
    const range = current && editor.contains(current.commonAncestorContainer) ? current.cloneRange() : selectionRef.current
    if (!range || !editor.contains(range.commonAncestorContainer)) return false
    editor.focus({ preventScroll: true })
    selection.removeAllRanges()
    selection.addRange(range)
    return true
  }, [editorRef])

  const emitChange = useCallback((typingKind?: string) => {
    const editor = editorRef.current
    if (!editor || internalDrag.current || formattingBatch.current) return
    const normalized = normalizeEditorHtml(editor.innerHTML)
    let element: Node | null | undefined = window.getSelection()?.anchorNode
    while (element && element.parentNode !== editor) element = element.parentNode
    const block = element instanceof HTMLElement ? Array.from(editor.children).indexOf(element) : -1
    historyRef.current.record({ html: normalized, block: block < 0 ? undefined : block }, typingKind)
    updateHistoryButtons()
    if (normalized === lastEmittedRef.current) return
    lastEmittedRef.current = normalized
    onChange(normalized)
  }, [onChange, editorRef, updateHistoryButtons])

  const stepHistory = useCallback((direction: 'undo' | 'redo') => {
    const editor = editorRef.current
    if (!editor || composingRef.current) return
    emitChange()
    const snapshot = historyRef.current.step(direction)
    if (!snapshot) return
    editor.replaceChildren(...parseEditorContent(snapshot.html).childNodes)
    lastEmittedRef.current = snapshot.html
    const caret = document.createRange()
    caret.selectNodeContents(editor.children[snapshot.block ?? 0] ?? editor)
    caret.collapse(snapshot.block === undefined)
    editor.focus({ preventScroll: true })
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(caret)
    selectionRef.current = caret.cloneRange()
    updateHistoryButtons()
    onChange(snapshot.html)
  }, [editorRef, emitChange, onChange, updateHistoryButtons])

  useEffect(() => {
    const editor = editorRef.current
    if (showPrintPreview || !editor) return
    const onBrowserHistory = (event: InputEvent) => {
      if (event.inputType !== 'historyUndo' && event.inputType !== 'historyRedo') return
      if (!event.cancelable) return
      event.preventDefault()
      stepHistory(event.inputType === 'historyUndo' ? 'undo' : 'redo')
    }
    editor.addEventListener('beforeinput', onBrowserHistory)
    return () => editor.removeEventListener('beforeinput', onBrowserHistory)
  }, [showPrintPreview, editorRef, stepHistory])

  const handleFontChange = useCallback((fontFamily: string) => {
    setCurrentFont(fontFamily)
    if (restoreSelection()) {
      exec('fontName', fontFamily)
      emitChange()
    }
  }, [emitChange, restoreSelection])

  const handleFontSizeChange = useCallback((fontSize: number) => {
    setCurrentFontSize(fontSize)
    if (editorRef.current && restoreSelection()) applyFontSize(editorRef.current, fontSize)
    emitChange()
  }, [emitChange, restoreSelection, editorRef])

  const handleAlignmentChange = useCallback((alignment: 'left' | 'center' | 'right' | 'justify') => {
    const editor = editorRef.current
    if (!editor || !restoreSelection()) return

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
  }, [emitChange, restoreSelection, editorRef])

  const handleOffsetChange = (delta: number) => {
    const editor = editorRef.current
    if (!editor || !restoreSelection()) return
    for (const block of getSelectedBlocks(editor)) {
      const offset = Math.max(-MAX_OFFSET_CHARS, Math.min(MAX_OFFSET_CHARS, (readOffset(block.dataset.offsetChars) ?? 0) + delta))
      if (offset) block.dataset.offsetChars = String(offset)
      else delete block.dataset.offsetChars
      block.style.transform = offsetTransform(offset) ?? ''
    }
    emitChange()
  }

  const handleParagraphMove = (direction: 'up' | 'down') => {
    const editor = editorRef.current
    if (!editor || !restoreSelection()) return
    const blocks = getSelectedBlocks(editor).filter((block) => block.parentElement === editor)
    if (!blocks.length) return
    const neighbor = direction === 'up' ? blocks[0].previousElementSibling : blocks[blocks.length - 1].nextElementSibling
    if (!neighbor) return
    if (direction === 'up') neighbor.before(...blocks)
    else neighbor.after(...blocks)
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(blocks[0])
    range.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(range)
    selectionRef.current = range.cloneRange()
    emitChange()
  }

  const handleInlineCommand = (command: 'bold' | 'italic' | 'underline') => {
    if (restoreSelection()) {
      exec(command)
      emitChange()
    }
  }

  const cancelPainter = useCallback(() => {
    if (painterClickTimerRef.current !== null) clearTimeout(painterClickTimerRef.current)
    painterClickTimerRef.current = null
    setPainterState({ active: false, persistent: false, format: null })
  }, [])

  const handleModeChange = () => {
    if (!showPrintPreview) emitChange()
    cancelPainter()
    setShowPrintPreview(!showPrintPreview)
  }

  useEffect(() => {
    if (showPrintPreview) return
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelPainter()
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown)
      if (painterClickTimerRef.current !== null) clearTimeout(painterClickTimerRef.current)
    }
  }, [showPrintPreview, cancelPainter])

  const handlePainterClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const editor = editorRef.current
    if (!editor) return

    if (painterState.active) {
      cancelPainter()
      return
    }

    restoreSelection()
    const format = getFormatAtSelection(editor)
    if (!format) return

    if (e.detail === 0) {
      setPainterState({ active: true, persistent: false, format })
    } else if (e.detail === 1) {
      painterClickTimerRef.current = setTimeout(() => {
        painterClickTimerRef.current = null
        setPainterState({ active: true, persistent: false, format })
      }, 220)
    } else if (e.detail === 2) {
      if (painterClickTimerRef.current) {
        clearTimeout(painterClickTimerRef.current)
        painterClickTimerRef.current = null
      }
      setPainterState({ active: true, persistent: true, format })
    }
  }, [painterState.active, cancelPainter, restoreSelection, editorRef])

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault()
    const html = event.clipboardData.getData('text/html')
    const text = event.clipboardData.getData('text/plain')
    if (html) {
      const content = parseEditorContent(html)
      if (!insertLayoutParagraphs(event.currentTarget, content)) exec('insertHTML', content.innerHTML)
    }
    else if (text) exec('insertText', text)
    emitChange()
  }

  const handleEditorMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!painterState.active || !painterState.format) return

    const editor = editorRef.current
    if (!editor) return

    formattingBatch.current = true
    try {
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
    } finally {
      formattingBatch.current = false
    }

    emitChange()

    if (!painterState.persistent) {
      setPainterState({ active: false, persistent: false, format: null })
    }
  }, [painterState, emitChange, editorRef])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || composingRef.current) return
    const key = e.key.toLowerCase()
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === 'z' || key === 'y')) {
      e.preventDefault()
      stepHistory(key === 'y' || e.shiftKey ? 'redo' : 'undo')
      return
    }
    if (/^(Arrow|Page|Home|End)/.test(e.key)) historyRef.current.breakTyping()
    if (e.key !== 'Backspace') return

    const selection = window.getSelection()
    if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return

    const range = selection.getRangeAt(0)
    const block = (range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer as HTMLElement
      : range.startContainer.parentElement
    )?.closest('p')

    if (!block || block.dataset.noIndent === 'true' || !parseFloat(window.getComputedStyle(block).textIndent)) return

    const blockRange = document.createRange()
    blockRange.selectNodeContents(block)
    blockRange.setEnd(range.startContainer, range.startOffset)
    const textBeforeCaret = blockRange.toString()

    if (textBeforeCaret.length === 0) {
      block.dataset.noIndent = 'true'
      emitChange()
      e.preventDefault()
    }
  }, [emitChange, stepHistory])

  return (
    <div className="preview-container">
      <div className="preview-header">
        <div className="preview-header-top">
          <span className="preview-label">{showPrintPreview ? '分页预览' : '版面编辑'}</span>
          {showPrintPreview && pageCount > 0 && (
            <span className="preview-hint">共 {pageCount} 页</span>
          )}
          <button
            type="button"
            className={`preview-toggle${showPrintPreview ? ' preview-toggle--active' : ''}`}
            onClick={handleModeChange}
            aria-controls="document-preview"
          >
            {showPrintPreview ? '编辑' : '预览'}
          </button>
          {!showPrintPreview && (
            <div className="preview-history" role="group" aria-label="编辑历史" onMouseDown={(event) => event.preventDefault()}>
              <button type="button" className="preview-history-btn" disabled={!historyButtons.undo}
                title="撤销上一步（Ctrl+Z）" onClick={() => stepHistory('undo')}>撤销</button>
              <button type="button" className="preview-history-btn" disabled={!historyButtons.redo}
                title="还原已撤销的修改（Ctrl+Y）" onClick={() => stepHistory('redo')}>还原</button>
            </div>
          )}
        </div>
        {!showPrintPreview && (
        <div className="preview-toolbar" onMouseDown={(event) => {
          if ((event.target as Element).closest('button')) event.preventDefault()
        }}>
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
          <button type="button" className="preview-tool-btn" aria-label="加粗" onClick={() => handleInlineCommand('bold')}><strong>B</strong></button>
          <button type="button" className="preview-tool-btn" aria-label="斜体" onClick={() => handleInlineCommand('italic')}><em>I</em></button>
          <button type="button" className="preview-tool-btn" aria-label="下划线" onClick={() => handleInlineCommand('underline')}><u>U</u></button>
          <button
            type="button"
            className={`preview-tool-btn preview-tool-btn--painter${
              painterState.active ? ' preview-tool-btn--active' : ''
            }${painterState.persistent ? ' preview-tool-btn--persistent' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={handlePainterClick}
            aria-pressed={painterState.active}
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
          <div className="preview-move-tools" role="group" aria-label="段落移动">
            <button type="button" className="preview-tool-btn" aria-label="左移一字" title="将当前段落或选中段落左移一字" onClick={() => handleOffsetChange(-1)}>←</button>
            <button type="button" className="preview-tool-btn" aria-label="右移一字" title="将当前段落或选中段落右移一字" onClick={() => handleOffsetChange(1)}>→</button>
            <button type="button" className="preview-tool-btn" aria-label="上移段落" title="将当前段落或选中段落上移" onClick={() => handleParagraphMove('up')}>↑</button>
            <button type="button" className="preview-tool-btn" aria-label="下移段落" title="将当前段落或选中段落下移" onClick={() => handleParagraphMove('down')}>↓</button>
          </div>
          {(config.header.enabled || config.footerNote.enabled || signature.name || signature.date) && (
            <span className="preview-hint">版头、版记和备用落款在「设置」中修改</span>
          )}
          {painterState.active && (
            <span className="preview-painter-badge">
              {painterState.persistent ? '连续刷格式中 (Esc退出)' : '刷格式中 (Esc退出)'}
            </span>
          )}
        </div>
        )}
      </div>
      <div className="preview-scroll" id="document-preview" style={cssVars}>
        {showPrintPreview ? (
          <PrintPreview ast={ast} config={config} onPageCountChange={setPageCount} />
        ) : (
        <div
          className="preview-scale-frame"
          ref={editFrameRef}
          style={{ height: `${editHeight * editScale}px` }}
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
                    role="textbox"
                    aria-label="版面编辑区"
                    aria-multiline="true"
                    suppressContentEditableWarning
                    onInput={(event) => {
                      const { inputType, isComposing } = event.nativeEvent as InputEvent
                      if (isComposing || composingRef.current) return
                      const typing = /^(insertText|deleteContentBackward|deleteContentForward)$/.test(inputType) ? inputType : undefined
                      emitChange(typing)
                    }}
                    onPaste={handlePaste}
                    onDragStart={() => {
                      const selection = window.getSelection()
                      internalDrag.current = !!(selection?.rangeCount && !selection.isCollapsed &&
                        editorRef.current?.contains(selection.getRangeAt(0).commonAncestorContainer))
                    }}
                    onDrop={(event) => {
                      if (!internalDrag.current || event.dataTransfer.files.length) event.preventDefault()
                    }}
                    onDragEnd={() => {
                      internalDrag.current = false
                      emitChange()
                    }}
                    onCompositionStart={() => {
                      composingRef.current = true
                      historyRef.current.breakTyping()
                    }}
                    onCompositionEnd={() => {
                      composingRef.current = false
                      emitChange()
                    }}
                    onBlur={() => emitChange()}
                    onKeyDown={handleKeyDown}
                    onMouseUp={handleEditorMouseUp}
                  />
                </div>
                {renderA4FooterNote(config.footerNote)}
                {/* 落款：空三行，署名右空 4-5 字，日期居中于署名 */}
                {(signature.name || signature.date) && (() => {
                  const { name: nameS, date: dateS } = signature
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
