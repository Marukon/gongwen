import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Editor } from './components/Editor/Editor'
import { Preview } from './components/Preview/Preview'
import { Toolbar } from './components/Toolbar/Toolbar'
import { useDocumentParser } from './hooks/useDocumentParser'
import { useDocumentConfig } from './contexts/useDocumentConfig'
import { parseGongwen, parseRichGongwen } from './parser'
import { autoFixDocumentText, sanitizeText } from './utils/sanitize'
import { astToStyledHtml, editorHtmlToPlainText, normalizeEditorHtml, restoreLegacySpacers } from './utils/richText'
import { DRAFT_KEY, type DocumentDraft } from './utils/documentDraft'
import { useDraftStorage } from './hooks/useDraftStorage'
import { syncSourceText } from './utils/syncSourceText'
import type { DocumentConfig } from './types/documentConfig'
import './App.css'

const STORAGE_KEY_VERSION_SEQ = 'docx-editor-version-seq'
const STORAGE_KEY_VERSION_DATE = 'docx-editor-version-date'

const baseDate = (() => {
  const v = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__.split('-')[0] : ''
  if (/^v\d{4}\.\d{2}\.\d{2}$/.test(v)) return v
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `v${y}.${m}.${d}`
})()

function loadVersionSeq(currentBaseDate: string): number {
  try {
    const savedDate = localStorage.getItem(STORAGE_KEY_VERSION_DATE)
    if (savedDate === currentBaseDate) {
      const savedSeq = parseInt(localStorage.getItem(STORAGE_KEY_VERSION_SEQ) || '1', 10)
      if (!Number.isNaN(savedSeq) && savedSeq >= 1) return savedSeq
    }
  } catch {
    // ignore
  }
  return 1
}

function formatSource(text: string, config: DocumentConfig) {
  return astToStyledHtml(parseGongwen(sanitizeText(text, config.textFixOptions).text, { preserveEmptyLines: true }), config)
}

function App() {
  const { config, updateConfig } = useDocumentConfig()
  const prepare = (draft: DocumentDraft, legacy: boolean): DocumentDraft => {
    if (draft.editedHtml === null) return draft
    if (!legacy) return { ...draft, editedHtml: normalizeEditorHtml(draft.editedHtml) }
    const reference = formatSource(draft.text, config)
    const html = restoreLegacySpacers(draft.editedHtml, reference, config.specialOptions.hasStamp)
    return { text: syncSourceText(draft.text, editorHtmlToPlainText(reference), editorHtmlToPlainText(html)), editedHtml: html }
  }
  const { draft, setDraft, current: currentDraftRef, failed: draftSaveFailed, active, alternatives, open } = useDraftStorage(prepare)
  const { text, editedHtml } = draft
  const [versionSeq, setVersionSeq] = useState(() => loadVersionSeq(baseDate))
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [fixFeedback, setFixFeedback] = useState('')
  const layoutEditorRef = useRef<HTMLDivElement>(null)
  const importActiveRef = useRef(false)

  const formattedHtml = useMemo(() => editedHtml ?? formatSource(text, config), [text, editedHtml, config])
  const ast = useDocumentParser(formattedHtml, config.specialOptions.hasStamp)
  const prevDraftRef = useRef(draft)

  const setText = useCallback((nextText: string) => {
    setDraft((previous) => previous.text === nextText ? previous : { text: nextText, editedHtml: null })
  }, [setDraft])

  const handleFormattedChange = useCallback((html: string, restoredSource?: string) => {
    if (html === formattedHtml && restoredSource === undefined) return text
    const next = restoredSource ?? syncSourceText(text, editorHtmlToPlainText(formattedHtml), editorHtmlToPlainText(html))
    setDraft({ text: next, editedHtml: html })
    return next
  }, [formattedHtml, text, setDraft])

  // 监听编辑改动，防抖 600ms 递增版本序号并持久化
  useEffect(() => {
    if (draft === prevDraftRef.current) return
    const timer = setTimeout(() => {
      prevDraftRef.current = draft
      setVersionSeq((prev) => prev + 1)
    }, 600)

    return () => clearTimeout(timer)
  }, [draft])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_VERSION_SEQ, String(versionSeq))
      localStorage.setItem(STORAGE_KEY_VERSION_DATE, baseDate)
    } catch {
      // 版本标记不影响当前草稿。
    }
  }, [versionSeq])

  useEffect(() => {
    if (!fixFeedback) return

    const timer = setTimeout(() => setFixFeedback(''), 3000)
    return () => clearTimeout(timer)
  }, [fixFeedback])

  const handleExport = useCallback(async () => {
    const layout = layoutEditorRef.current
    const html = layout ? normalizeEditorHtml(layout.innerHTML) : null
    const exportAst = html !== null && html !== formattedHtml ? parseRichGongwen(html, config.specialOptions.hasStamp) : ast
    if (html !== null && html !== formattedHtml) handleFormattedChange(html)
    setExporting(true)

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })

    try {
      const { downloadDocx } = await import('./exporter/download')
      await downloadDocx(exportAst, config)
    } catch (err) {
      console.error('导出失败:', err)
      // 动态导入 chunk 404 通常是部署更新后浏览器缓存了旧 index.html
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('dynamically imported module') || msg.includes('Failed to fetch')) {
        alert('页面资源已更新，请强制刷新（Ctrl+F5）后再导出')
      } else {
        alert('导出失败，请检查控制台日志')
      }
    } finally {
      setExporting(false)
    }
  }, [ast, config, formattedHtml, handleFormattedChange])

  const handleClear = useCallback(() => {
    if (confirm('清空当前草稿？原文和手工排版都将移除。')) setDraft({ text: '', editedHtml: null })
  }, [setDraft])

  const handleImport = useCallback(async (file: File) => {
    if (importActiveRef.current) return
    const initial = currentDraftRef.current
    if ((initial.text.trim() || initial.editedHtml !== null) && !confirm('导入文件将覆盖当前内容，是否继续？')) return
    importActiveRef.current = true
    setImporting(true)
    try {
      const { importFile } = await import('./utils/fileImporter')
      const result = await importFile(file)
      if (currentDraftRef.current !== initial && !confirm('导入期间草稿有新修改。仍要用文件覆盖吗？')) return
      setDraft({ text: result.text, editedHtml: null })
    } catch (err) {
      alert(err instanceof Error ? err.message : '文件导入失败')
    } finally {
      importActiveRef.current = false
      setImporting(false)
    }
  }, [currentDraftRef, setDraft])

  const handleAutoFix = useCallback(() => {
    const { textFixOptions } = config
    if (
      !textFixOptions.convertEnglishPunctuation &&
      !textFixOptions.removeRedundantSpaces &&
      !textFixOptions.removeMeaninglessLineBreaks
    ) {
      setFixFeedback('高级设置中已关闭全部文本修复选项')
      return
    }

    const result = autoFixDocumentText(text, textFixOptions)
    if (result.text !== text && editedHtml !== null && !confirm('整理会按左侧最新文字重新排版，覆盖手工格式和位置。继续整理吗？')) return
    setText(result.text)

    if (result.count === 0) {
      setFixFeedback('未发现需要修复的文本问题')
      return
    }

    const segments = []
    if (result.punctuationCount > 0) segments.push(`标点 ${result.punctuationCount} 处`)
    if (result.whitespaceCount > 0) segments.push(`空格 ${result.whitespaceCount} 处`)
    if (result.lineBreakCount > 0) segments.push(`回车 ${result.lineBreakCount} 处`)
    setFixFeedback(`已修复 ${result.count} 处：${segments.join('，')}`)
  }, [config, text, editedHtml, setText])

  return (
    <div className="app">
      <Toolbar
        ast={ast}
        onExport={handleExport}
        onClear={handleClear}
        onImport={handleImport}
        importing={importing}
        exporting={exporting}
        draftRevision={versionSeq}
      />
      {(alternatives.length > 0 || active !== DRAFT_KEY) && (
        <div className="draft-save-warning" role="status">
          {active === DRAFT_KEY ? '有其他窗口保留的草稿副本。' : '当前正在编辑独立副本，共享草稿已保留。'}
          <label> 打开草稿 <select value={active} onChange={e => open(e.target.value)}>
            <option value={DRAFT_KEY}>共享草稿</option>
            {alternatives.map((key, i) => <option key={key} value={key}>副本 {alternatives.length - i} · {new Date(Number(key.split(':')[2])).toLocaleString('zh-CN')}</option>)}
          </select></label>
        </div>
      )}
      {draftSaveFailed && <div className="draft-save-warning" role="status">浏览器未能保存草稿，关闭前请先导出或复制原文。</div>}
      <div className="app-main">
        <div className="app-editor">
          <Editor
            value={text}
            onChange={setText}
            onFileImport={handleImport}
            importing={importing}
            canTextCleanup={text.trim().length > 0}
            fixFeedback={fixFeedback}
            onTextCleanup={handleAutoFix}
            hasTitleNameDate={config.specialOptions.hasTitleNameDate}
            onToggleHasTitleNameDate={(value) =>
              updateConfig({ specialOptions: { hasTitleNameDate: value } })
            }
          />
        </div>
        <div className="app-preview">
          <Preview key={active} sourceText={text} value={formattedHtml} ast={ast} onChange={handleFormattedChange} editorRef={layoutEditorRef} />
        </div>
      </div>
    </div>
  )
}

export default App
