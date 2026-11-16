import React, { type CSSProperties, memo } from 'react'
import { getTitleLines, NodeType } from '../../types/ast'
import type { DocumentNode, AttachmentNode, RichTextRun } from '../../types/ast'
import type { HeaderConfig, FooterNoteConfig, SpecialOptionsConfig } from '../../types/documentConfig'
import { getPreviewFontFamily } from '../../utils/fontAliases'
import { ensureTitleDateParentheses, getTitleMetadataIndices, normalizeDocumentDate } from '../../utils/documentDates'
import { getHeadingSpans, headingClass, sliceHeadingText } from '../../parser/headings'
import './A4Page.css'

/** 节点类型 → CSS 类名映射 */
export const NODE_CLASS_MAP: Record<NodeType, string> = {
  [NodeType.DOCUMENT_TITLE]: 'a4-title',
  [NodeType.HEADING_1]: 'a4-h1',
  [NodeType.HEADING_2]: 'a4-h2',
  [NodeType.HEADING_3]: 'a4-h3',
  [NodeType.HEADING_4]: 'a4-h4',
  [NodeType.PARAGRAPH]: 'a4-paragraph',
  [NodeType.ADDRESSEE]: 'a4-addressee',
  [NodeType.ATTACHMENT]: 'a4-attachment',
  [NodeType.SIGNATURE]: 'a4-signature',
  [NodeType.DATE]: 'a4-date',
}

/**
 * 计算文本的实际宽度（以汉字宽度为单位）
 * - 中文字符（含年月日）：宽度 = 1 个汉字宽度
 * - 阿拉伯数字、英文字母：宽度约为汉字的 0.69 倍
 * - 其他 ASCII 字符：宽度约为汉字的 0.69 倍
 */
function calculateTextWidthEm(text: string): number {
  let width = 0
  for (const char of text) {
    if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(char)) {
      width += 1
    } else {
      width += 0.69
    }
  }
  return width
}

/**
 * 计算发文机关署名的右缩进值（em 单位）
 * 公式：基础右空字数 + (成文日期宽度 - 署名宽度) / 2
 * - 有印章（hasStamp = true）：基础右空四字
 * - 无印章（hasStamp = false）：基础右空二字
 * 注意：居中偏移可能为负数（署名比日期长时），只需保证最终右缩进 >= 0
 */
export function calculateSignatureIndentEm(
  signatureContent: string,
  dateContent: string,
  hasStamp: boolean
): number {
  const baseIndent = hasStamp ? 4 : 2
  const signatureWidth = calculateTextWidthEm(signatureContent)
  const dateWidth = calculateTextWidthEm(dateContent)
  const centerOffset = (dateWidth - signatureWidth) / 2
  return Math.max(0, baseIndent + centerOffset)
}

/* ------------------------------------------------------------------ */
/* 以下渲染函数提取为模块级，供 A4Page 与打印预览的隐藏度量容器共用， */
/* 确保度量结构与页面完全一致、分页行高准确。                          */
/* ------------------------------------------------------------------ */

/** 版头（发文机关标识 / 文号 / 签发人） */
export function renderA4Header(headerConfig: HeaderConfig, fontSizePt?: number): React.ReactNode {
  if (!headerConfig.enabled || !headerConfig.orgName) return null
  const isFormal = headerConfig.mode === 'formal'
  const hasMeta = isFormal && !!(headerConfig.docNumber || headerConfig.signer)
  const displayName = isFormal ? `${headerConfig.orgName}文件` : headerConfig.orgName
  const chars = Array.from(displayName)
  // 便签：版头在页眉区（距页顶 30mm），字体方正大标宋（GB/T 9704 10.1 信函格式）
  return (
    <div className={`a4-header-section${!isFormal ? ' a4-header-section--note' : ''}`}>
      <div
        className={`a4-header-org${!isFormal ? ' a4-header-org--note' : ''}`}
        style={fontSizePt ? { fontSize: `${fontSizePt}pt` } : undefined}
      >
        {chars.map((char, index) => (
          <span key={`${char}-${index}`} className="a4-header-org-char">
            {char === ' ' ? '\u00a0' : char}
          </span>
        ))}
      </div>
      {hasMeta && (
        <div className={`a4-header-meta${headerConfig.signer ? ' a4-header-meta--with-signer' : ''}`}>
          <span>{headerConfig.docNumber}</span>
          {headerConfig.signer && (
            <span>
              <span className="a4-header-signer-label">签发人：</span>
              <span className="a4-header-signer-name">{headerConfig.signer}</span>
            </span>
          )}
        </div>
      )}
      <div className="a4-header-separator"></div>
    </div>
  )
}

/** 版记（抄送 / 印发机关 / 印发日期） */
export function renderA4FooterNote(footerNoteConfig: FooterNoteConfig): React.ReactNode {
  if (!footerNoteConfig.enabled) return null
  const printDate = normalizeDocumentDate(footerNoteConfig.printDate) ?? footerNoteConfig.printDate
  return (
    <div className="a4-footer-note">
      <div className="a4-footer-note-line-top"></div>
      {footerNoteConfig.cc && (
        <div className="a4-footer-note-cc">
          <span className="a4-footer-note-cc-label">抄送：</span>
          <span className="a4-footer-note-cc-text">{ensureChinesePeriod(footerNoteConfig.cc)}</span>
        </div>
      )}
      {footerNoteConfig.cc && (footerNoteConfig.printer || footerNoteConfig.printDate) && (
        <div className="a4-footer-note-line-middle"></div>
      )}
      {(footerNoteConfig.printer || footerNoteConfig.printDate) && (
        <div className="a4-footer-note-printer">
          <span>{footerNoteConfig.printer}</span>
          <span>{printDate}{printDate && '印发'}</span>
        </div>
      )}
      <div className="a4-footer-note-line-bottom"></div>
    </div>
  )
}

/** 单个正文节点的缩进样式（署名/日期右空字数） */
function getA4NodeStyle(
  node: DocumentNode,
  index: number,
  hasStamp: boolean,
  body: DocumentNode[],
): CSSProperties | undefined {
  if (node.alignment) return { textAlign: node.alignment }
  if (node.type === NodeType.SIGNATURE) {
    const nextNode = body[index + 1]
    if (nextNode && nextNode.type === NodeType.DATE) {
      const indent = calculateSignatureIndentEm(node.content, nextNode.content, hasStamp)
      return { paddingRight: `${indent}em` }
    }
    return { paddingRight: `${hasStamp ? 4 : 2}em` }
  }
  if (node.type === NodeType.DATE) {
    return { paddingRight: `${hasStamp ? 4 : 2}em` }
  }
  return undefined
}

export interface A4ContentRenderOptions {
  title: DocumentNode | null
  body: DocumentNode[]
  hasTitleNameDate: boolean
  boldFirstSentence: boolean
  boldHeading3: boolean
  hasStamp: boolean
  /** 落款人（发文机关署名），有值则在正文末尾渲染落款 */
  signatureName?: string
  /** 落款日期 */
  signatureDate?: string
}

/** 估算文本宽度（em）：中文 1，其他 0.5 */
function estimateTextEm(text: string): number {
  let w = 0
  for (const c of text) {
    w += /[\u4e00-\u9fff\uff01-\uff5e\u3000-\u303f]/.test(c) ? 1 : 0.5
  }
  return w
}

/** 计算落款右空（em）：署名右空 4 字，日期长于署名 2 字以上则右空 5 字；日期居中于署名 */
export function getSignatureIndents(nameText: string, dateText: string): { nameIndentEm: number; dateIndentEm: number } {
  const nameW = nameText ? estimateTextEm(nameText) : 0
  const dateW = dateText ? estimateTextEm(dateText) : 0
  const dateIndentEm = dateW > nameW + 2 ? 5 : 4
  const nameIndentEm = Math.max(0, dateIndentEm + (dateW - nameW) / 2)
  return { nameIndentEm, dateIndentEm }
}

/** 渲染标题 + 正文流（不含版头/版记外壳） */
export function renderA4Content(opts: A4ContentRenderOptions): React.ReactNode {
  const { title, body, hasTitleNameDate, boldFirstSentence, boldHeading3, hasStamp, signatureName, signatureDate } = opts
  const metadata = getTitleMetadataIndices({ title, body }, hasTitleNameDate)
  return (
    <>
      {title && getTitleLines(title).map((line, idx, arr) => (
        <p
          key={`title-${title.lineNumber}-${idx}`}
          className={NODE_CLASS_MAP[title.type]}
          style={{ marginBottom: idx < arr.length - 1 ? 0 : undefined, textAlign: line.alignment }}
        >
          {hasRichStyleOverrides(line.runs) ? renderRichRuns(line.runs ?? []) : line.content}
        </p>
      ))}
      {body.flatMap((node, index) => {
        const elements: React.ReactNode[] = []

        // 无印章单机关公文，正文与署名之间空一行。
        if (node.type === NodeType.SIGNATURE && index !== metadata.name) {
          for (let j = 0; j < (hasStamp ? 3 : 1); j++) {
            elements.push(
              <p key={`empty-${node.lineNumber}-${j}`} className="a4-empty-line">{'\u200B'}</p>
            )
          }
        }

        // 附件说明特殊渲染
        if (node.type === NodeType.ATTACHMENT) {
          elements.push(
            <React.Fragment key={node.lineNumber}>
              {renderAttachment(node as AttachmentNode)}
            </React.Fragment>
          )
        } else {
          const role = index === metadata.name ? 'name' : index === metadata.date ? 'date' : null
          const spans = getHeadingSpans(node.content, node.type)
          let nodeClassName: string
          let nodeContent: React.ReactNode

          if (role === 'name') {
            nodeClassName = 'a4-title-secondary'
            nodeContent = hasRichStyleOverrides(node.runs)
              ? renderRichRuns(node.runs ?? [])
              : node.content
          } else if (role === 'date') {
            nodeClassName = 'a4-title-date'
            nodeContent = hasRichStyleOverrides(node.runs)
              ? renderRichRuns(node.runs ?? [])
              : ensureTitleDateParentheses(node.content)
          } else if (spans.length > 0) {
            nodeClassName = NODE_CLASS_MAP[node.type]
            nodeContent = renderHeadingSpans(node.content, spans, boldHeading3, hasRichStyleOverrides(node.runs) ? node.runs : undefined)
          } else if (hasRichStyleOverrides(node.runs)) {
            nodeClassName = NODE_CLASS_MAP[node.type]
            nodeContent = renderRichRuns(node.runs ?? [])
          } else if (
            boldFirstSentence &&
            node.type === NodeType.PARAGRAPH
          ) {
            nodeClassName = NODE_CLASS_MAP[node.type]
            nodeContent = node.content ? renderBoldFirstSentence(node.content) : <br />
          } else {
            nodeClassName = NODE_CLASS_MAP[node.type]
            nodeContent = node.content ? node.content : <br />
          }

          elements.push(
            <p
              key={node.lineNumber}
              className={nodeClassName}
              data-no-indent={node.noIndent || undefined}
              style={role ? { textAlign: node.alignment } : getA4NodeStyle(node, index, hasStamp, body)}
            >
              {nodeContent}
            </p>
          )
        }

        return elements
      })}
      {/* 落款（发文机关署名 + 成文日期）：空三行，署名右空 4-5 字，日期居中于署名 */}
      {(signatureName || signatureDate) && (() => {
        const { nameIndentEm, dateIndentEm } = getSignatureIndents(signatureName ?? '', signatureDate ?? '')
        return (
          <>
            {[0, 1, 2].map((j) => (
              <p key={`sig-empty-${j}`} className="a4-empty-line">{'\u200B'}</p>
            ))}
            {signatureName && (
              <p
                className="a4-signature a4-signature-standalone"
                style={{ paddingRight: `${nameIndentEm}em` }}
              >
                {signatureName}
              </p>
            )}
            {signatureDate && (
              <p
                className="a4-date a4-date-standalone"
                style={{ paddingRight: `${dateIndentEm}em` }}
              >
                {signatureDate}
              </p>
            )}
          </>
        )
      })()}
      {!title && body.length === 0 && (
        <p className="a4-placeholder">预览区域</p>
      )}
    </>
  )
}

function hasRichStyleOverrides(runs?: RichTextRun[]): boolean {
  return !!runs?.some((run) => run.bold !== undefined || run.italic !== undefined || run.underline || run.fontFamily || run.fontSize)
}

function renderRichRuns(runs: RichTextRun[]) {
  return runs.map((run, index) => (
    <span
      key={`${index}-${run.text}`}
      style={{
        fontFamily: run.fontFamily ? getPreviewFontFamily(run.fontFamily) : undefined,
        fontSize: run.fontSize ? `${run.fontSize}pt` : undefined,
        fontWeight: run.bold === undefined ? undefined : run.bold ? 'bold' : 'normal',
        fontStyle: run.italic === undefined ? undefined : run.italic ? 'italic' : 'normal',
        textDecoration: run.underline ? 'underline' : undefined,
      }}
    >
      {run.text}
    </span>
  ))
}

function renderHeadingSpans(content: string, spans: ReturnType<typeof getHeadingSpans>, bold = true, richRuns?: RichTextRun[]) {
  return sliceHeadingText(content, spans, richRuns).map(({ text, type, runs }, index) => (
    <span key={index} className={type ? headingClass(type, bold) : 'a4-paragraph-inline'}>{runs ? renderRichRuns(runs) : text}</span>
  ))
}

/**
 * 渲染正文首句加粗：
 * - 普通段落：首句（到第一个“。”）加粗，其余正常。
 */
function renderBoldFirstSentence(content: string): React.ReactNode {
  const idx = content.indexOf('。')
  if (idx === -1 || idx === content.length - 1) {
    return <span className="a4-bold-first">{content}</span>
  }

  return (
    <>
      <span className="a4-bold-first">{content.slice(0, idx + 1)}</span>
      <span>{content.slice(idx + 1)}</span>
    </>
  )
}

/**
 * 渲染附件说明
 *
 * 单附件模式：附件：xxx
 * 多附件模式：附件：1.xxx
 *                   2.xxx
 *                   3.xxx
 */
function renderAttachment(node: AttachmentNode): React.ReactNode {
  if (!node.isMultiple) {
    // 单附件模式
    return (
      <p className="a4-attachment a4-attachment--single">
        附件：{node.items[0].name}
      </p>
    )
  }

  // 多附件模式
  const elements: React.ReactNode[] = []

  // 第一个附件紧跟在 "附件：" 后
  const firstItem = node.items[0]
  elements.push(
    <p key="first" className="a4-attachment a4-attachment--multi-first">
      附件：{firstItem.index}.{firstItem.name}
    </p>
  )

  // 从第二个附件开始，每项单独一行
  for (let i = 1; i < node.items.length; i++) {
    const item = node.items[i]
    elements.push(
      <p key={i} className="a4-attachment-item a4-attachment-item--multi">
        {item.index}.{item.name}
      </p>
    )
  }

  return <>{elements}</>
}

interface A4PageProps {
  title: DocumentNode | null
  body: DocumentNode[]
  pageNumber: number
  /** 内容流偏移量(px)，用于视窗裁剪定位 */
  offsetY: number
  /** 该页应显示的内容高度(px)，精确到行边界 */
  clipHeight: number
  /** 是否显示页码 */
  showPageNumber: boolean
  /** 首页不显示页码（第一页不显示页码，从第二页开始） */
  firstPageNoNumber?: boolean
  /** 是否对正文首句加粗 */
  boldFirstSentence: boolean
  /** 是否对三级标题加粗 */
  boldHeading3: boolean
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
  /**
   * 是否加盖印章
   * - true: 成文日期右空四字 (GB/T 9704 7.3.5.1)
   * - false: 成文日期右空二字 (GB/T 9704 7.3.5.2)
   */
  hasStamp: boolean
  /**
   * 是否「标题下署名 + 日期」版式（「有人名日期」复选框）
   * - true: 第二行渲染为姓名(a4-title-secondary)、第三行为日期(a4-title-date)
   * - false: 第二行起按正文处理
   */
  hasTitleNameDate: boolean
  /** 版头中发文机关标志的字体大小(pt)，未传则使用 CSS 默认 */
  headerOrgFontSize?: number
  /** 落款人（发文机关署名），有值则在正文末尾渲染落款 */
  signatureName?: string
  /** 落款日期 */
  signatureDate?: string
}

function ensureChinesePeriod(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  return /[。！？!?]$/.test(trimmed) ? trimmed : `${trimmed}。`
}

export const A4Page = memo(function A4Page({
  title,
  body,
  pageNumber,
  offsetY,
  clipHeight,
  showPageNumber,
  firstPageNoNumber,
  boldFirstSentence,
  boldHeading3,
  headerConfig,
  footerNoteConfig,
  isFirstPage,
  isLastPage,
  pageNumberLayout,
  hasStamp,
  hasTitleNameDate,
  headerOrgFontSize,
  signatureName,
  signatureDate,
}: A4PageProps) {
  /**
   * 计算节点的动态样式
   * - SIGNATURE: 以成文日期为基准居中
   * - DATE: 根据 hasStamp 右空四字或二字
   */
  return (
    <div className="a4-page">
      <div className="a4-content">
        {/* 版头：仅在第一页且启用时渲染 */}
        {isFirstPage && renderA4Header(headerConfig, headerOrgFontSize)}
        <div className="a4-content-viewport" style={{ height: `${clipHeight}px` }}>
          <div style={{ transform: `translateY(-${offsetY}px)` }}>
            {renderA4Content({ title, body, hasTitleNameDate, boldFirstSentence, boldHeading3, hasStamp, signatureName, signatureDate })}
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
