import type { DocumentNode, GongwenAST, AttachmentNode } from '../types/ast'
import { NodeType } from '../types/ast'
import { detectNodeType, ATTACHMENT_RE, extractAttachmentItemsFromLine } from './matchers'
import { normalizeDocumentDate, readTitleByline, readTitleDate } from '../utils/documentDates'

/** 不应被识别为发文机关署名的结尾标点 */
const SIGNATURE_EXCLUDE_ENDINGS = ['。', '：', ':', '；', ';', '！', '!', '？', '?', '，', ',']
/** 机关署名常见关键词（用于降低正文误判） */
const SIGNATURE_ORG_HINTS = [
  '人民政府',
  '政府',
  '委员会',
  '办公厅',
  '办公室',
  '党委',
  '党组',
  '部',
  '厅',
  '局',
  '委',
  '院',
  '会',
  '集团',
  '公司',
  '中央',
]

/** 主送机关通常是简短的受文机关列表；超过此长度的冒号结尾行视为正文（如"现就…通知如下："开头的长句） */
const ADDRESSEE_MAX_LENGTH = 60

/** 主送机关检测窗口：标题后前 N 个非空行内首次出现的冒号结尾短行识别为主送机关 */
const ADDRESSEE_PREAMBLE_MAX_LINES = 4

export interface ParsedLineInput extends Pick<DocumentNode, 'runs' | 'alignment' | 'noIndent' | 'offsetChars' | 'paragraphIndentTwips' | 'bylineRole'> {
  text: string
  lineNumber: number
  layoutType?: NodeType.DOCUMENT_TITLE | NodeType.SIGNATURE | NodeType.DATE | NodeType.ADDRESSEE
  attachmentLine?: AttachmentNode['layoutLine']
}

/** 标题不应包含的结尾标点（用于判断是否为完整标题或标题断行） */
const TITLE_STRONG_ENDINGS = ['。', '！', '!', '？', '?']
const ORG_PREFIX_MAX_LEN = 30
const TITLE_FRAGMENT_MAX_LEN = 30
const TITLE_MERGED_MAX_LEN = 120
const PREAMBLE_MAX_LINES = 4

const SUBTITLE_RE = /^[\u2014\u2015\u2500\u2013-]{1,2}\s*/

function isSubtitleLine(line: string): boolean {
  const text = line.trim()
  return SUBTITLE_RE.test(text)
}

function isPossibleAddressee(line: string): boolean {
  if (!(line.endsWith('：') || line.endsWith(':'))) return false
  if (line.length > ADDRESSEE_MAX_LENGTH) return false
  if (/如下[：:]$/.test(line)) return false
  return detectNodeType(line) === NodeType.PARAGRAPH
}

/** 遇到以下行时立即停止标题提取，将其交由正文处理 */
function isStructuralPreambleStop(text: string): boolean {
  if (readTitleByline(text) || readTitleDate(text)) return true
  if (detectNodeType(text) !== NodeType.PARAGRAPH) return true
  if (isPossibleAddressee(text)) return true
  return false
}

function isOrgPrefixLine(line: string): boolean {
  const text = line.trim()
  if (text.length === 0 || text.length > ORG_PREFIX_MAX_LEN) return false
  if (isPossibleAddressee(text)) return false
  if (detectNodeType(text) !== NodeType.PARAGRAPH) return false
  if (SIGNATURE_EXCLUDE_ENDINGS.some((e) => text.endsWith(e))) return false
  return hasSignatureOrgHint(text)
}

function isTitleFragment(line: string): boolean {
  const text = line.trim()
  if (text.length === 0 || text.length > TITLE_FRAGMENT_MAX_LEN) return false
  if (isPossibleAddressee(text)) return false
  if (detectNodeType(text) !== NodeType.PARAGRAPH) return false
  if (TITLE_STRONG_ENDINGS.some((e) => text.endsWith(e))) return false
  return true
}

function isStandaloneTitleLine(line: string): boolean {
  const text = line.trim()
  if (text.length === 0 || text.length > TITLE_MERGED_MAX_LEN) return false
  if (isPossibleAddressee(text)) return false
  if (detectNodeType(text) !== NodeType.PARAGRAPH) return false
  if (TITLE_STRONG_ENDINGS.some((e) => text.endsWith(e))) return false
  return true
}

const GONGWEN_GENRE_ENDINGS = [
  '决议', '决定', '命令', '公报', '公告', '通告', '意见',
  '通知', '通报', '报告', '请示', '批复', '议案', '条例',
  '规定', '办法', '函', '纪要', '方案', '预案', '细则'
]

function endsWithGenre(text: string): boolean {
  const clean = text.replace(/[”’）》」』\s]+$/, '')
  return GONGWEN_GENRE_ENDINGS.some(genre => clean.endsWith(genre))
}

function isNameBeforeDate(lines: ParsedLineInput[], index: number): boolean {
  if (index >= lines.length) return false
  const text = lines[index].text.trim()
  if (text.length === 0 || text.length > 15) return false
  for (let next = index + 1; next < lines.length; next++) {
    const nextText = lines[next].text.trim()
    if (nextText.length === 0) continue
    return readTitleDate(nextText) !== null
  }
  return false
}

/**
 * 从文首提取公文标题：
 * - 可识别文头机关前缀行，与后续标题一起作为公文标题（机关行保留在 title.content 中，用 \n 连接）
 * - 可合并连续多行标题片段（无标点拆分标题）
 * - 可识别副标题行（以 —— 开头），作为副标题换行并入 title.content
 * 返回 title 与 body 循环起始下标 startIndex
 */
function extractPreamble(lines: ParsedLineInput[]): { title: DocumentNode | null; startIndex: number } {
  let i = 0
  while (i < lines.length && lines[i].text.trim().length === 0) i++
  if (i >= lines.length) {
    return { title: null, startIndex: lines.length }
  }

  const firstSource = lines[i]
  const first = firstSource.text.trim()
  if (isStructuralPreambleStop(first)) {
    return { title: null, startIndex: i }
  }

  let orgPrefix: string | null = null
  let orgLineNumber = 0

  if (isOrgPrefixLine(first)) {
    let j = i + 1
    while (j < lines.length && lines[j].text.trim().length === 0) j++
    if (j < lines.length) {
      const next = lines[j].text.trim()
      if (!isStructuralPreambleStop(next) && (isTitleFragment(next) || isStandaloneTitleLine(next))) {
        orgPrefix = first
        orgLineNumber = firstSource.lineNumber
        i = j
      } else {
        return {
          title: {
            type: NodeType.DOCUMENT_TITLE,
            content: first,
            lineNumber: firstSource.lineNumber,
            runs: firstSource.runs,
            alignment: firstSource.alignment,
            noIndent: firstSource.noIndent,
          },
          startIndex: i + 1,
        }
      }
    } else {
      return {
        title: {
          type: NodeType.DOCUMENT_TITLE,
          content: first,
          lineNumber: firstSource.lineNumber,
          runs: firstSource.runs,
          alignment: firstSource.alignment,
          noIndent: firstSource.noIndent,
        },
        startIndex: i + 1,
      }
    }
  }

  const titleSource = lines[i]
  const firstTitle = titleSource.text.trim()
  if (!isStandaloneTitleLine(firstTitle) && !isTitleFragment(firstTitle)) {
    if (TITLE_STRONG_ENDINGS.some((e) => firstTitle.endsWith(e)) || firstTitle.length > TITLE_MERGED_MAX_LEN) {
      return { title: null, startIndex: i }
    }
    return {
      title: {
        type: NodeType.DOCUMENT_TITLE,
        content: orgPrefix ? `${orgPrefix}\n${firstTitle}` : firstTitle,
        lineNumber: orgPrefix ? orgLineNumber : titleSource.lineNumber,
        runs: titleSource.runs,
        alignment: titleSource.alignment,
        noIndent: titleSource.noIndent,
      },
      startIndex: i + 1,
    }
  }

  const parts: string[] = [firstTitle]
  const mainSources = [titleSource]
  const titleLineNumber = orgPrefix ? orgLineNumber : titleSource.lineNumber
  let cursor = i + 1

  // 如果首行标题本身已经以公文文种（通知、通报等）结尾，说明标题主体已完整，不向后拼接片段
  if (!endsWithGenre(firstTitle)) {
    while (parts.length < PREAMBLE_MAX_LINES && cursor < lines.length) {
      const raw = lines[cursor].text
      if (raw.trim().length === 0) break
      const t = raw.trim()
      if (isStructuralPreambleStop(t)) break
      if (isSubtitleLine(t)) break
      if (isNameBeforeDate(lines, cursor)) break
      if (!isTitleFragment(t)) break
      const merged = parts.join('') + t
      if (merged.length > TITLE_MERGED_MAX_LEN) break
      parts.push(t)
      mainSources.push(lines[cursor])
      cursor++
      if (endsWithGenre(t)) break
    }
  }

  // 检查是否有副标题（以 —— 开头）
  let subtitle: ParsedLineInput | null = null
  let subtitleCursor = cursor
  while (subtitleCursor < lines.length && lines[subtitleCursor].text.trim().length === 0) {
    if (subtitleCursor - cursor >= 2) break
    subtitleCursor++
  }
  if (subtitleCursor < lines.length) {
    const possibleSubtitle = lines[subtitleCursor].text.trim()
    if (isSubtitleLine(possibleSubtitle)) {
      subtitle = lines[subtitleCursor]
      cursor = subtitleCursor + 1
    }
  }

  const toTitleLine = (source: ParsedLineInput, content: string) => ({
    content, lineNumber: source.lineNumber, runs: source.runs,
    alignment: source.alignment, noIndent: source.noIndent,
  })
  const main = toTitleLine(titleSource, parts.join(''))
  if (mainSources.some((source) => source.runs)) {
    main.runs = mainSources.flatMap((source) => source.runs ?? [{ text: source.text.trim() }])
  }
  const titleLines = [
    ...(orgPrefix ? [toTitleLine(firstSource, orgPrefix)] : []),
    main,
    ...(subtitle ? [toTitleLine(subtitle, subtitle.text.trim())] : []),
  ]

  return {
    title: {
      type: NodeType.DOCUMENT_TITLE,
      content: titleLines.map((line) => line.content).join('\n'),
      lineNumber: titleLineNumber,
      runs: main.runs,
      titleLines,
      alignment: titleSource.alignment,
      noIndent: titleSource.noIndent,
    },
    startIndex: cursor,
  }
}

/** 查找排除尾部附件说明后的逻辑正文结尾下标 */
function findLogicalBodyEnd(body: DocumentNode[]): number {
  let end = body.length
  while (end > 0 && (body[end - 1].type === NodeType.ATTACHMENT || body[end - 1].content === '')) {
    end--
  }
  return end
}

/**
 * 检查节点是否可能为发文机关署名
 * 条件：类型为 PARAGRAPH，内容长度不超过15字，不以特定标点结尾
 */
function isPossibleSignature(node: DocumentNode | undefined): boolean {
  if (!node || node.type !== NodeType.PARAGRAPH) return false
  const content = node.content.trim()
  if (content.length === 0 || content.length > 15) return false
  return !SIGNATURE_EXCLUDE_ENDINGS.some(ending => content.endsWith(ending))
}

/** 机关名称关键词检查（避免把普通短句识别为署名） */
function hasSignatureOrgHint(text: string): boolean {
  return SIGNATURE_ORG_HINTS.some((hint) => text.includes(hint))
}


/** 构造单附件节点（保留原始文本，避免信息丢失） */
function buildSingleAttachmentNode(source: ParsedLineInput, contentAfterColon: string): AttachmentNode {
  return {
    type: NodeType.ATTACHMENT,
    content: source.text,
    lineNumber: source.lineNumber,
    runs: source.runs,
    alignment: source.alignment,
    isMultiple: false,
    items: [{ index: 0, name: contentAfterColon }],
    noIndent: source.noIndent,
  }
}

/**
 * 解析附件说明
 *
 * 单附件模式：附件：xxx（冒号后无数字或数字不是1）
 * 多附件模式：附件：1.xxx 2.xxx ...（冒号后紧跟数字1）
 */
function parseAttachment(
  source: ParsedLineInput,
  lines: ParsedLineInput[],
  currentIndex: number
): { node: AttachmentNode; nextIndex: number } {
  // 1. 提取冒号后的内容
  const colonMatch = source.text.trim().match(/^附件[：:](.*)$/)
  if (!colonMatch) {
    throw new Error('Invalid attachment line')
  }
  const contentAfterColon = colonMatch[1].trim()

  // 2. 判断单附件还是多附件
  const firstItemMatch = contentAfterColon.match(/^(\d+)[.．．.]/)

  if (!firstItemMatch || firstItemMatch[1] !== '1') {
    // 单附件模式：冒号后不是 "1." 开头
    return {
        node: buildSingleAttachmentNode(source, contentAfterColon),
        nextIndex: currentIndex + 1,
      }
  }

  // 3. 多附件模式：收集所有附件项
  const items: AttachmentNode['items'] = []
  let remainingText = contentAfterColon
  let expectedIndex = 1
  // 记录已消费的最后一行索引（初始为当前行）
  let lastConsumedIndex = currentIndex

  while (true) {
    // 从当前文本中提取连续的附件项
    const { items: foundItems, remaining } = extractAttachmentItemsFromLine(
      remainingText,
      expectedIndex
    )

    // 当前行存在“部分可识别 + 剩余文本”时，不应吞掉剩余文本
    // 首行异常回退为单附件；后续行异常则不消费该行，交由主循环继续解析
    if (remaining.trim() !== '') {
      if (lastConsumedIndex === currentIndex) {
        return {
          node: buildSingleAttachmentNode(source, contentAfterColon),
          nextIndex: currentIndex + 1,
        }
      }
      return {
        node: {
          type: NodeType.ATTACHMENT,
          content: source.text,
          lineNumber: source.lineNumber,
          runs: source.runs,
          alignment: source.alignment,
          noIndent: source.noIndent,
          isMultiple: true,
          items,
        },
        nextIndex: lastConsumedIndex,
      }
    }

    if (foundItems.length === 0) {
      if (lastConsumedIndex === currentIndex) {
        return {
          node: buildSingleAttachmentNode(source, contentAfterColon),
          nextIndex: currentIndex + 1,
        }
      }
      return {
        node: {
          type: NodeType.ATTACHMENT,
          content: source.text,
          lineNumber: source.lineNumber,
          runs: source.runs,
          alignment: source.alignment,
          noIndent: source.noIndent,
          isMultiple: true,
          items,
        },
        nextIndex: lastConsumedIndex,
      }
    }

    items.push(...foundItems)
    expectedIndex += foundItems.length

    // 当前行的附件项已提取完毕，检查下一行是否有后续附件
    let nextLineIndex = lastConsumedIndex + 1
    while (nextLineIndex < lines.length && !lines[nextLineIndex].text.trim()) nextLineIndex++
    if (nextLineIndex < lines.length) {
      const nextLine = lines[nextLineIndex].text.trim()
      // 检查下一行是否以期望的序号开头
      const nextItemMatch = nextLine.match(/^(\d+)[.．．.]/)
      if (nextItemMatch && Number(nextItemMatch[1]) === expectedIndex) {
        remainingText = nextLine
        lastConsumedIndex = nextLineIndex
        continue
      }
    }
    break
  }

  return {
    node: {
      type: NodeType.ATTACHMENT,
      content: source.text,
      lineNumber: source.lineNumber,
      runs: source.runs,
      alignment: source.alignment,
      noIndent: source.noIndent,
      isMultiple: true,
      items,
    },
    nextIndex: lastConsumedIndex + 1,
  }
}

/**
 * 将纯文本解析为公文 AST（纯函数）
 *
 * 规则:
 * 1. 跳过空行
 * 2. 第一个非空行视为公文标题（DOCUMENT_TITLE）
 * 3. 后续行通过正则检测类型
 * 4. 解析完成后识别发文机关署名：
 *    - 当 DATE 位于末尾，且 DATE 前一个段落满足“短句 + 机关关键词”时改为 SIGNATURE
 *    - 当文末只有单位署名、没有 DATE 时，若末尾段落满足“短句 + 机关关键词”也改为 SIGNATURE
 */
export function parseGongwen(text: string, options?: { preserveEmptyLines?: boolean }): GongwenAST {
  const lines = text.split(/\r\n?|\n/).map((line, index) => ({ text: line, lineNumber: index + 1 }))
  return parseParsedLines(lines, options?.preserveEmptyLines ?? false)
}

export function parseParsedLines(lines: ParsedLineInput[], preserveEmptyLines = false, explicitLayout = false): GongwenAST {
  let title: DocumentNode | null = null
  let startIndex = 0
  if (explicitLayout) {
    // 标题只在当前位置组成标题区，移过的段落不会被重新提到文首。
    const titleLines: NonNullable<DocumentNode['titleLines']> = []
    while (lines[startIndex]?.layoutType === NodeType.DOCUMENT_TITLE && lines[startIndex].text.trim()) {
      const { text, lineNumber, runs, alignment, noIndent, offsetChars, paragraphIndentTwips } = lines[startIndex++]
      titleLines.push({ content: text.trim(), lineNumber, runs, alignment, noIndent, offsetChars, paragraphIndentTwips })
    }
    if (titleLines.length) title = {
      type: NodeType.DOCUMENT_TITLE,
      content: titleLines.map((line) => line.content).join('\n'),
      lineNumber: titleLines[0].lineNumber,
      titleLines,
    }
  } else {
    ({ title, startIndex } = extractPreamble(lines))
  }
  const body: DocumentNode[] = []

  let nonEmptyLinesAfterTitle = 0
  let addresseeFound = false
  let i = startIndex

  while (i < lines.length) {
    const source = lines[i]
    const trimmed = source.text.trim()
    const { lineNumber, alignment, noIndent, offsetChars, paragraphIndentTwips, bylineRole } = source
    const layout = { lineNumber, alignment, noIndent, offsetChars, paragraphIndentTwips, bylineRole }

    // 跳过空行（标题之前 / 普通正文之间）
    if (trimmed.length === 0) {
      // 预览手动编辑场景下保留空行，使增删「回车」能如实反映到导出结果
      if (preserveEmptyLines && (title !== null || explicitLayout)) {
        body.push({
          type: NodeType.PARAGRAPH,
          content: '',
          ...layout,
          runs: source.runs,
        })
      }
      i++
      continue
    }

    // 标题后的非空行计数，用于主送机关检测窗口
    if (title !== null) {
      nonEmptyLinesAfterTitle++
    }

    if (source.attachmentLine) {
      const node: AttachmentNode = {
        ...layout, type: NodeType.ATTACHMENT, content: trimmed, runs: source.runs,
        layoutLine: source.attachmentLine, isMultiple: source.attachmentLine !== 'single', items: [],
      }
      body.push(node)
      i++
      continue
    }

    // 主送机关检测（标题后前 N 个非空行内首次出现的冒号结尾短行）
    if (!source.layoutType && !addresseeFound && nonEmptyLinesAfterTitle <= ADDRESSEE_PREAMBLE_MAX_LINES) {
      if (isPossibleAddressee(trimmed)) {
        addresseeFound = true
        body.push({ ...layout, type: NodeType.ADDRESSEE, content: trimmed, runs: source.runs })
        i++
        continue
      }
    }

    // 附件说明检测
    if (ATTACHMENT_RE.test(trimmed)) {
      const { node, nextIndex } = parseAttachment(source, lines, i)
      body.push(node)
      i = nextIndex
      continue
    }

    // 正则检测类型
    const type = source.layoutType ?? detectNodeType(trimmed)
    const content = type === NodeType.DATE && !source.layoutType ? normalizeDocumentDate(trimmed) ?? trimmed : trimmed
    let runs = source.runs
    if (runs && content !== trimmed) {
      // 日期规范化只去除空格和前导零，保留其余字符原有的行内样式。
      let nextChar = 0
      runs = runs.map((run) => ({
        ...run,
        text: Array.from(run.text).filter((char) => {
          if (char !== content[nextChar]) return false
          nextChar++
          return true
        }).join(''),
      })).filter((run) => run.text)
    }
    body.push({ ...layout, type, content, runs })
    i++
  }

  // 识别发文机关署名：先去尾部附件得到"逻辑文末"，保证附件不干扰署名识别
  const logicalEnd = findLogicalBodyEnd(body)

  // 1) 署名 + 日期场景（在逻辑文末中相邻）
  if (logicalEnd >= 2 && body[logicalEnd - 1].type === NodeType.DATE) {
    const prev = body[logicalEnd - 2]
    if (isPossibleSignature(prev) && (hasSignatureOrgHint(prev.content) || /^值班室/.test(prev.content))) {
      body[logicalEnd - 2] = { ...prev, type: NodeType.SIGNATURE }
    }
  } else if (logicalEnd >= 1) {
    // 2) 兼容“只有单位、没有日期”的文末署名（逻辑文末末尾）
    const last = body[logicalEnd - 1]
    if (isPossibleSignature(last) && hasSignatureOrgHint(last.content)) {
      body[logicalEnd - 1] = { ...last, type: NodeType.SIGNATURE }
    }
  }

  return explicitLayout ? { title, body, layoutEditable: true } : { title, body }
}
