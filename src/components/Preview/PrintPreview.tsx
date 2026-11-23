import { useEffect, useMemo, useRef } from 'react'
import { A4Page } from './A4Page'
import {
  contentRows,
  renderA4Header,
  renderA4FooterNote,
} from './a4Content'
import { getHeaderOrgFontSize } from '../../utils/documentLayout'
import { usePagination } from '../../hooks/usePagination'
import { useFitScale } from '../../hooks/useFitScale'
import type { GongwenAST } from '../../types/ast'
import type { DocumentConfig } from '../../types/documentConfig'
import { getSupplementalSignature } from '../../utils/documentDates'
import {
  A4_RENDER_WIDTH_PX,
  A4_RENDER_HEIGHT_PX,
  A4_PAGE_GAP_PX,
} from '../../types/documentConfig'
import { buildA4CssVars } from './pageLayoutStyles'
import './A4Page.css'
import './PrintPreview.css'

interface PrintPreviewProps {
  ast: GongwenAST
  config: DocumentConfig
  /** 页数变化回调（供外层头部展示「共 N 页」） */
  onPageCountChange?: (count: number) => void
}

/**
 * 打印预览：基于 A4Page + usePagination 的真实分页渲染。
 * 隐藏的度量容器与 A4Page 结构（版头/正文/版记）完全一致，确保行高度量准确。
 */
export function PrintPreview({ ast, config, onPageCountChange }: PrintPreviewProps) {
  const measurerRef = useRef<HTMLDivElement>(null)
  const cssVars = useMemo(() => buildA4CssVars(config), [config])
  const pages = usePagination(ast.title, ast.body, measurerRef, config)
  const headerOrgFontSize = useMemo(
    () => getHeaderOrgFontSize(config.header.orgName, config.margins.left, config.margins.right, config.header.mode === 'formal'),
    [config.header.orgName, config.margins.left, config.margins.right, config.header.mode],
  )

  // 整体缩放：以真实 A4 尺寸（794px）渲染，再等比缩放到预览区可用宽度（上限 1，不放大）
  const { frameRef, scale } = useFitScale(A4_RENDER_WIDTH_PX)
  const scaledHeight =
    pages.length > 0
      ? (pages.length * A4_RENDER_HEIGHT_PX + (pages.length - 1) * A4_PAGE_GAP_PX) * scale
      : 0

  useEffect(() => {
    onPageCountChange?.(pages.length)
  }, [pages.length, onPageCountChange])

  const rows = useMemo(() => {
    const signature = getSupplementalSignature(ast, config.specialOptions)
    return contentRows({ ...ast, ...config.specialOptions, signatureName: signature.name, signatureDate: signature.date })
  }, [ast, config.specialOptions])

  return (
    <div className="print-preview" style={cssVars}>
      {/* 隐藏度量容器：渲染完整 A4 页（版头+正文+版记），保持"未缩放"真实尺寸，
          usePagination 从中读取页面/页边距/版头/版记高度，保证分页与缩放后可见页一致。 */}
      <div className="a4-measurer" ref={measurerRef} aria-hidden="true">
        <div className="a4-page">
          <div className="a4-content">
            {renderA4Header(config.header, headerOrgFontSize)}
            <div className="a4-content-viewport" style={{ height: '100%' }}>
              <div className="a4-measurer-content">
                {rows}
              </div>
            </div>
          </div>
          {renderA4FooterNote(config.footerNote)}
        </div>
      </div>

      {/* 可见页：固定真实 A4 尺寸渲染，整体缩放适配 */}
      <div
        className="preview-scale-frame"
        ref={frameRef}
        style={scaledHeight ? { height: `${scaledHeight}px` } : undefined}
      >
        <div className="preview-scale-content" style={{ transform: `scale(${scale})` }}>
          {pages.map((slice, i) => (
            <A4Page
              key={i}
              pageNumber={i + 1}
              offsetY={slice.offsetY}
              clipHeight={slice.clipHeight}
              showPageNumber={config.specialOptions.showPageNumber}
              firstPageNoNumber={config.specialOptions.firstPageNoNumber}
              headerConfig={config.header}
              footerNoteConfig={config.footerNote}
              isFirstPage={i === 0}
              isLastPage={i === pages.length - 1}
              pageNumberLayout={config.specialOptions.pageNumberStyle}
              headerOrgFontSize={headerOrgFontSize}
            >{rows.slice(slice.firstRow, slice.endRow)}</A4Page>
          ))}
        </div>
      </div>
    </div>
  )
}
