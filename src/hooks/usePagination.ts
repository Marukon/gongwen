import { useEffect, useState, type RefObject } from 'react'
import type { DocumentNode } from '../types/ast'
import type { DocumentConfig } from '../types/documentConfig'

/** 单页裁剪信息 */
export interface PageSlice {
  /** 本页涉及的段落范围 [firstRow, endRow)。 */
  firstRow: number
  endRow: number
  /** 本页从第一个段落的哪个垂直位置开始（px）。 */
  offsetY: number
  /** 该页应显示的内容高度(px)，精确到行边界 */
  clipHeight: number
}

function arePagesEqual(prev: PageSlice[], next: PageSlice[]): boolean {
  if (prev.length !== next.length) return false

  for (let i = 0; i < prev.length; i++) {
    if (
      prev[i].firstRow !== next[i].firstRow || prev[i].endRow !== next[i].endRow ||
      Math.abs(prev[i].offsetY - next[i].offsetY) > 0.5
      || Math.abs(prev[i].clipHeight - next[i].clipHeight) > 0.5
    ) {
      return false
    }
  }

  return true
}

/**
 * DOM 度量分页 hook（视窗裁剪方案）
 *
 * 在隐藏的度量容器中渲染全部节点，通过 offsetTop / offsetHeight / lineHeight
 * 逐行计算分页断点。每页只需一个 offsetY 值，配合 CSS overflow:hidden + transform
 * 偏移实现段落内自然跨页断行。
 *
 * 关键：首页扣除版头（.a4-header-section）高度，末页扣除版记（.a4-footer-note）高度，
 * 避免 clipHeight 超出父容器实际可用空间导致 overflow:hidden 截断内容。
 *
 * 同时监听 ResizeObserver，窗口缩放时自动重新分页。
 */
export function usePagination(
  title: DocumentNode | null,
  body: DocumentNode[],
  measurerRef: RefObject<HTMLDivElement | null>,
  config: DocumentConfig
): PageSlice[] {
  const [pages, setPages] = useState<PageSlice[]>(() => [{ firstRow: 0, endRow: 0, offsetY: 0, clipHeight: 0 }])

  useEffect(() => {
    const measurer = measurerRef.current
    if (!measurer) return
    let frameId = 0

    function calculate() {
      const el = measurerRef.current
      if (!el) {
        setPages([{ firstRow: 0, endRow: 0, offsetY: 0, clipHeight: 0 }])
        return
      }

      const scrollContainer = el.parentElement
      if (!scrollContainer) {
        setPages([{ firstRow: 0, endRow: 0, offsetY: 0, clipHeight: 0 }])
        return
      }

      // The measurement page and visible pages share the same unscaled A4 width.
      const a4Page = el.querySelector<HTMLElement>('.a4-page')

      // ② 读取 .a4-content 内容区全量高度（= 页面高度 - 上下 padding）
      //    这是不含版头/版记时的最大可用空间。
      let fullAvailable: number
      const a4Content = a4Page?.querySelector('.a4-content') as HTMLElement | null
      if (a4Content) {
        const rect = a4Content.getBoundingClientRect()
        const contentCs = getComputedStyle(a4Content)
        fullAvailable = rect.height
          - parseFloat(contentCs.paddingTop) - parseFloat(contentCs.paddingBottom)
      } else {
        // 首次渲染无 A4 页面时回退到 JS 公式
        const pageWidth = el.getBoundingClientRect().width
        const pageHeight = pageWidth * (297 / 210)
        const topPad = pageWidth * (config.margins.top * 10 / 210)
        const bottomPad = pageWidth * (config.margins.bottom * 10 / 210)
        fullAvailable = pageHeight - topPad - bottomPad
      }

      // ③ 度量版头高度（首页渲染，含外边距；flex column 中 margin 不折叠）
      let headerHeight = 0
      const headerSection = scrollContainer.querySelector('.a4-header-section') as HTMLElement | null
      if (headerSection) {
        const hs = getComputedStyle(headerSection)
        headerHeight = headerSection.getBoundingClientRect().height
          + parseFloat(hs.marginTop) + parseFloat(hs.marginBottom)
      }

      // ④ 度量版记高度（末页绝对定位于 .a4-page 底部，需预留空间防重叠）
      let footerNoteHeight = 0
      const footerNote = scrollContainer.querySelector('.a4-footer-note') as HTMLElement | null
      if (footerNote) {
        footerNoteHeight = footerNote.getBoundingClientRect().height
      }

      // 首页可用高度 = 全量 - 版头占位
      const firstPageAvailable = fullAvailable - headerHeight

      // ⑤ 获取度量容器内所有段落
      const contentEl = el.querySelector('.a4-measurer-content')
      if (!contentEl) {
        setPages([{ firstRow: 0, endRow: 0, offsetY: 0, clipHeight: firstPageAvailable }])
        return
      }

      const paragraphs = contentEl.querySelectorAll<HTMLParagraphElement>(':scope > p')
      if (paragraphs.length === 0) {
        setPages([{ firstRow: 0, endRow: 0, offsetY: 0, clipHeight: firstPageAvailable }])
        return
      }

      const origin = contentEl.getBoundingClientRect().top
      const rows = Array.from(paragraphs, p => {
        const box = p.getBoundingClientRect()
        return { top: box.top - origin, bottom: box.bottom - origin,
          line: parseFloat(getComputedStyle(p).lineHeight), keepNext: p.dataset.keepNext === 'true' }
      })
      // Adjacent signature/date paragraphs form one breakable unit only if the pair fits a page.
      const units: { top: number; bottom: number; first: number; end: number }[] = []
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i], next = rows[i + 1]
        if (row.keepNext && next && next.bottom - row.top <= fullAvailable) {
          units.push({ top: row.top, bottom: next.bottom, first: i, end: i + 2 })
          i++
          continue
        }
        const count = row.line > 0 ? Math.max(1, Math.round((row.bottom - row.top) / row.line)) : 1
        for (let j = 0; j < count; j++) units.push({
          top: j ? row.top + j * row.line : row.top,
          bottom: j + 1 === count ? row.bottom : row.top + (j + 1) * row.line,
          first: i, end: i + 1,
        })
      }
      const result: PageSlice[] = []
      let from = 0, start = 0
      function finish(to: number, bottom: number) {
        const first = units[from]?.first ?? rows.length
        result.push({ firstRow: first, endRow: to > from ? units[to - 1].end : first,
          offsetY: start - (rows[first]?.top ?? start), clipHeight: Math.max(0, bottom - start) })
        from = to
        start = bottom
      }
      for (let i = 0; i < units.length; i++) {
        const unit = units[i]
        const available = result.length ? fullAvailable : firstPageAvailable
        if (unit.bottom - start > available + 0.5 &&
          (i > from || (!result.length && headerHeight > 0 && unit.bottom - unit.top <= fullAvailable))) {
          finish(i, unit.top)
        }
      }
      const bottom = rows[rows.length - 1].bottom
      const capacity = result.length ? fullAvailable : firstPageAvailable
      if (footerNoteHeight > 0 && bottom - start + footerNoteHeight > capacity + 0.5) {
        const last = units[units.length - 1]
        if (last.bottom - last.top + footerNoteHeight <= fullAvailable && (units.length - 1 > from || headerHeight > 0 && !result.length)) {
          finish(units.length - 1, last.top)
        } else {
          finish(units.length, bottom)
        }
      }
      finish(units.length, bottom)

      setPages((prev) => (arePagesEqual(prev, result) ? prev : result))
    }

    function scheduleCalculate() {
      cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(() => {
        frameId = 0
        calculate()
      })
    }

    scheduleCalculate()

    // 监听尺寸变化（窗口缩放时重新分页）
    const observer = new ResizeObserver(() => scheduleCalculate())
    const flow = measurer.querySelector('.a4-measurer-content')
    if (flow) observer.observe(flow)
    observer.observe(measurer)
    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
    }
  }, [title, body, measurerRef, config])

  return pages
}
