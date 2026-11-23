import { memo, type ReactNode } from 'react'
import type { HeaderConfig, FooterNoteConfig, SpecialOptionsConfig } from '../../types/documentConfig'
import { renderA4Header, renderA4FooterNote } from './a4Content'

interface A4PageProps {
  children: ReactNode
  pageNumber: number
  /** 内容流偏移量(px)，用于视窗裁剪定位 */
  offsetY: number
  /** 该页应显示的内容高度(px)，精确到行边界 */
  clipHeight: number
  /** 是否显示页码 */
  showPageNumber: boolean
  /** 首页不显示页码（第一页不显示页码，从第二页开始） */
  firstPageNoNumber?: boolean
  /** 版头配置 */
  headerConfig: HeaderConfig
  /** 版记配置 */
  footerNoteConfig: FooterNoteConfig
  /** 是否为第一页 */
  isFirstPage: boolean
  /** 是否为最后一页 */
  isLastPage: boolean
  /** 页码布局 */
  pageNumberLayout: SpecialOptionsConfig['pageNumberStyle']
  /** 版头中发文机关标志的字体大小(pt)，未传则使用 CSS 默认 */
  headerOrgFontSize?: number
}

export const A4Page = memo(function A4Page({
  children,
  pageNumber,
  offsetY,
  clipHeight,
  showPageNumber,
  firstPageNoNumber,
  headerConfig,
  footerNoteConfig,
  isFirstPage,
  isLastPage,
  pageNumberLayout,
  headerOrgFontSize,
}: A4PageProps) {
  return (
    <div className="a4-page">
      <div className="a4-content">
        {/* 版头：仅在第一页且启用时渲染 */}
        {isFirstPage && renderA4Header(headerConfig, headerOrgFontSize)}
        <div className="a4-content-viewport" style={{ height: `${clipHeight}px` }}>
          <div className="a4-page-rows" style={{ transform: `translateY(${-offsetY}px)` }}>
            {children}
          </div>
        </div>
      </div>
      {/* 版记：绝对定位到最后一页底部，末条线与版心下边缘重合 */}
      {isLastPage && renderA4FooterNote(footerNoteConfig)}
      {showPageNumber && !(firstPageNoNumber && isFirstPage) && (
        <div
          className={
            `a4-footer ${
              pageNumberLayout === 'center'
                ? 'a4-footer-center'
                : pageNumber % 2 === 0
                  ? 'a4-footer-even'
                  : 'a4-footer-odd'
            }`
          }
        >
          — {pageNumber} —
        </div>
      )}
    </div>
  )
})
