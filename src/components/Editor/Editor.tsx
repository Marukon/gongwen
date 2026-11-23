import { memo, useState, useCallback, useRef, type DragEvent } from 'react'
import './Editor.css'

interface EditorProps {
  value: string
  onChange: (value: string) => void
  canTextCleanup: boolean
  fixFeedback?: string
  onFileImport: (file: File) => void
  onTextCleanup: () => void
  importing?: boolean
  /** 是否启用「标题下署名 + 日期」版式（第二行姓名 / 第三行日期） */
  hasTitleNameDate?: boolean
  /** 切换「标题下署名 + 日期」版式 */
  onToggleHasTitleNameDate?: (value: boolean) => void
}

export const Editor = memo(function Editor({
  value,
  onChange,
  canTextCleanup,
  fixFeedback,
  onFileImport,
  onTextCleanup,
  importing,
  hasTitleNameDate = false,
  onToggleHasTitleNameDate,
}: EditorProps) {
  const [dragging, setDragging] = useState(false)
  const dragCounterRef = useRef(0)

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (dragCounterRef.current === 1) setDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) setDragging(false)
  }, [])

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    dragCounterRef.current = 0

    const file = e.dataTransfer.files[0]
    if (file) onFileImport(file)
  }, [onFileImport])

  return (
    <div
      className="editor-container"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="editor-header">
        <div className="editor-header-main">
          <span className="editor-label">原文</span>
          <span className="editor-hint">右侧改字会同步到这里；修改此处原文会重新排版。</span>
        </div>
        <div className="editor-header-actions">
          {fixFeedback && (
            <span className="editor-feedback" title={fixFeedback}>
              {fixFeedback}
            </span>
          )}
          {onToggleHasTitleNameDate && (
            <label
              className="editor-checkbox"
              title="常见讲话稿会自动识别标题下的姓名和日期。其他文稿可勾选此项开启识别。"
            >
              <input
                type="checkbox"
                checked={hasTitleNameDate}
                onChange={(e) => onToggleHasTitleNameDate(e.target.checked)}
              />
              <span>有人名日期</span>
            </label>
          )}
          <button
            type="button"
            className="editor-action-btn"
            onClick={onTextCleanup}
            disabled={!canTextCleanup}
            title="清理多余空行、空格和英文标点，衔接讲话稿分项与紧随其后的说明"
          >
            整理原文
          </button>
        </div>
      </div>

      <textarea
        className="editor-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`关于XXX的通知\n\n一、总体要求\n为深入贯彻落实……\n（一）指导思想\n坚持以……\n1.加强组织领导\n（1）制定实施方案\n各部门要……`}
        spellCheck={false}
      />

      {dragging && (
        <div className="editor-drop-overlay">
          <span>释放文件以导入</span>
        </div>
      )}
      {importing && (
        <div className="editor-drop-overlay editor-drop-overlay--importing">
          <span>正在提取文本…</span>
        </div>
      )}
    </div>
  )
})
