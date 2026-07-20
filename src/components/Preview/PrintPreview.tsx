import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import {
  A4Page,
  renderA4Content,
} from './A4Page'
import { usePagination, type PaginationConfig } from '../../hooks/usePagination'
import type { GongwenAST } from '../../types/ast'
import type { DocumentConfig } from '../../types/documentConfig'
import { CHARS_PER_LINE, cmToPagePercent } from '../../types/documentConfig'
import './A4Page.css'
import './PrintPreview.css'

/** 由 config 推导 A4 页面所需的 CSS 变量（与预览编辑区保持一致的页边距/字体/字间距） */
function buildA4CssVars(config: DocumentConfig): CSSProperties {
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
    '--page-number-font': config.specialOptions.pageNumberFont,
  } as CSSProperties
}

function buildPaginationConfig(config: DocumentConfig): PaginationConfig {
  return {
    margins: { ...config.margins },
    header: {
      enabled: config.header.enabled,
      orgName: config.header.orgName,
      docNumber: config.header.docNumber,
      signer: config.header.signer,
    },
    footerNote: {
      enabled: config.footerNote.enabled,
      cc: config.footerNote.cc,
      printer: config.footerNote.printer,
      printDate: config.footerNote.printDate,
    },
    title: {
      fontFamily: config.title.fontFamily,
      fontSize: config.title.fontSize,
      lineSpacing: config.title.lineSpacing,
    },
    body: {
      fontFamily: config.body.fontFamily,
      asciiFontFamily: config.body.asciiFontFamily,
      fontSize: config.body.fontSize,
      lineSpacing: config.body.lineSpacing,
      firstLineIndent: config.body.firstLineIndent,
    },
    advanced: {
      h1: { fontFamily: config.advanced.h1.fontFamily, fontSize: config.advanced.h1.fontSize },
      h2: { fontFamily: config.advanced.h2.fontFamily, fontSize: config.advanced.h2.fontSize },
      h3: { fontFamily: config.advanced.h3.fontFamily, fontSize: config.advanced.h3.fontSize },
    },
    specialOptions: {
      boldFirstSentence: config.specialOptions.boldFirstSentence,
      boldHeading3: config.specialOptions.boldHeading3,
      hasStamp: config.specialOptions.hasStamp,
    },
  }
}

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
  const paginationConfig = useMemo(() => buildPaginationConfig(config), [config])
  const pages = usePagination(ast.title, ast.body, measurerRef, paginationConfig)

  useEffect(() => {
    onPageCountChange?.(pages.length)
  }, [pages.length, onPageCountChange])

  const contentOpts = {
    title: ast.title,
    body: ast.body,
    hasTitleNameDate: config.specialOptions.hasTitleNameDate,
    boldFirstSentence: config.specialOptions.boldFirstSentence,
    boldHeading3: config.specialOptions.boldHeading3,
    hasStamp: config.specialOptions.hasStamp,
  }

  return (
    <div className="print-preview" style={cssVars}>
      {/* 隐藏度量容器：渲染全部节点用于高度测量（与 A4Page 使用相同的渲染逻辑） */}
      <div className="a4-measurer" ref={measurerRef} aria-hidden="true">
        <div className="a4-measurer-content">
          {renderA4Content(contentOpts)}
        </div>
      </div>

      {pages.map((slice, i) => (
        <A4Page
          key={i}
          title={ast.title}
          body={ast.body}
          pageNumber={i + 1}
          offsetY={slice.offsetY}
          clipHeight={slice.clipHeight}
          showPageNumber={config.specialOptions.showPageNumber}
          boldFirstSentence={config.specialOptions.boldFirstSentence}
          boldHeading3={config.specialOptions.boldHeading3}
          headerConfig={config.header}
          footerNoteConfig={config.footerNote}
          isFirstPage={i === 0}
          isLastPage={i === pages.length - 1}
          pageNumberLayout={config.specialOptions.pageNumberLayout}
          hasStamp={config.specialOptions.hasStamp}
          hasTitleNameDate={config.specialOptions.hasTitleNameDate}
        />
      ))}
    </div>
  )
}
