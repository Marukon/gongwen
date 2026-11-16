import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Editor } from './components/Editor/Editor'
import { Preview } from './components/Preview/Preview'
import { Toolbar } from './components/Toolbar/Toolbar'
import { useDocumentParser } from './hooks/useDocumentParser'
import { useDocumentConfig } from './contexts/useDocumentConfig'
import { parseGongwen, parseRichGongwen } from './parser'
import { autoFixDocumentText, sanitizeText } from './utils/sanitize'
import { astToStyledHtml, normalizeEditorHtml } from './utils/richText'
import { loadDraft, saveDraft, type DocumentDraft } from './utils/documentDraft'
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

function readDraft(): DocumentDraft {
  try {
    const draft = loadDraft(localStorage)
    return { ...draft, editedHtml: draft.editedHtml === null ? null : normalizeEditorHtml(draft.editedHtml) }
  } catch {
    return { text: '', editedHtml: null }
  }
}

function App() {
  const [draft, setDraft] = useState(readDraft)
  const { text, editedHtml } = draft
  const [versionSeq, setVersionSeq] = useState(() => loadVersionSeq(baseDate))
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [fixFeedback, setFixFeedback] = useState('')
  const [draftSaveFailed, setDraftSaveFailed] = useState(false)
  const layoutEditorRef = useRef<HTMLDivElement>(null)
  const currentDraftRef = useRef(draft)
  const importActiveRef = useRef(false)

  useLayoutEffect(() => {
    currentDraftRef.current = draft
  }, [draft])

  const { config, updateConfig } = useDocumentConfig()
  const formattedHtml = useMemo(() => {
    if (editedHtml !== null) return editedHtml
    const sanitized = sanitizeText(text, config.textFixOptions).text
    return astToStyledHtml(parseGongwen(sanitized, { preserveEmptyLines: true }), config)
  }, [text, editedHtml, config])
  const ast = useDocumentParser(formattedHtml)
  const prevDraftRef = useRef(draft)

  const setText = useCallback((nextText: string) => {
    setDraft((previous) => previous.text === nextText ? previous : { text: nextText, editedHtml: null })
  }, [])

  const handleFormattedChange = useCallback((html: string) => {
    if (html === formattedHtml) return
    setDraft((previous) => ({ ...previous, editedHtml: html }))
  }, [formattedHtml])

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
    try {
      saveDraft(localStorage, draft)
      setDraftSaveFailed(false)
    } catch {
      setDraftSaveFailed(true)
    }
  }, [draft])

  useEffect(() => {
    if (!fixFeedback) return

    const timer = setTimeout(() => setFixFeedback(''), 3000)
    return () => clearTimeout(timer)
  }, [fixFeedback])

  const handleExport = useCallback(async () => {
    const layout = layoutEditorRef.current
    const html = layout ? normalizeEditorHtml(layout.innerHTML) : null
    const exportAst = html !== null && html !== formattedHtml ? parseRichGongwen(html) : ast
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
    setDraft({ text: '', editedHtml: null })
  }, [])

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
  }, [])

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
  }, [config, text, setText])

  return (
    <div className="app">
      <Toolbar
        ast={ast}
        onExport={handleExport}
        onClear={handleClear}
        onImport={handleImport}
        importing={importing}
        exporting={exporting}
        version={`${baseDate}-${versionSeq}`}
      />
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
          <Preview value={formattedHtml} ast={ast} onChange={handleFormattedChange} editorRef={layoutEditorRef} />
        </div>
      </div>
    </div>
  )
}

export default App
