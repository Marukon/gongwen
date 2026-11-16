import {
  Document, Paragraph, TextRun, Footer, Header, PageNumber,
  AlignmentType, BorderStyle, LineRuleType,
  Table, TableRow, TableCell, WidthType,
  TableAnchorType, RelativeHorizontalPosition, RelativeVerticalPosition, OverlapType,
} from 'docx'
import type { IRunOptions, IBorderOptions, IParagraphOptions } from 'docx'
import type { GongwenAST, DocumentNode, AttachmentNode, RichTextRun } from '../types/ast'
import { getTitleLines, NodeType } from '../types/ast'
import type { DocumentConfig, PageNumberStyle } from '../types/documentConfig'
import { cmToTwip, ptToTwip } from '../types/documentConfig'
import { ensureTitleDateParentheses, getSupplementalSignature, getTitleMetadataIndices, normalizeDocumentDate, readTitleByline } from '../utils/documentDates'
import { getHeadingSpans, isDiscourseHeading, sliceHeadingText } from '../parser/headings'
import {
  createCharacterFirstLineIndent,
  getParagraphStyle,
  getRunStyle,
  getAttachmentParagraphStyle,
  getAttachmentRunStyle,
  hasRichStyleOverrides,
  buildRunStyleOverride,
} from './styleFactory'

type StaticParagraphType =
  | NodeType.DOCUMENT_TITLE
  | NodeType.HEADING_1
  | NodeType.HEADING_2
  | NodeType.HEADING_3
  | NodeType.HEADING_4
  | NodeType.ADDRESSEE
  | NodeType.PARAGRAPH
  | NodeType.DATE

interface BuildStyleCache {
  attachmentRunStyle: Partial<IRunOptions>
  bodyRunStyle: Partial<IRunOptions>
  runStyles: Record<NodeType, Partial<IRunOptions>>
  paragraphStyles: Record<StaticParagraphType, Partial<IParagraphOptions>>
  attachmentParagraphStyles: {
    single: Partial<IParagraphOptions>
    singleNoSpacingBefore: Partial<IParagraphOptions>
    multiFirst: Partial<IParagraphOptions>
    multiFirstNoSpacingBefore: Partial<IParagraphOptions>
    multiRest: Partial<IParagraphOptions>
  }
  useCharacterIndent: Set<NodeType>
}

function createBuildStyleCache(config: DocumentConfig): BuildStyleCache {
  const paragraphNodeTypes: StaticParagraphType[] = [
    NodeType.DOCUMENT_TITLE,
    NodeType.HEADING_1,
    NodeType.HEADING_2,
    NodeType.HEADING_3,
    NodeType.HEADING_4,
    NodeType.ADDRESSEE,
    NodeType.PARAGRAPH,
    NodeType.DATE,
  ]

  const runNodeTypes: NodeType[] = [
    NodeType.DOCUMENT_TITLE,
    NodeType.HEADING_1,
    NodeType.HEADING_2,
    NodeType.HEADING_3,
    NodeType.HEADING_4,
    NodeType.ADDRESSEE,
    NodeType.PARAGRAPH,
    NodeType.SIGNATURE,
    NodeType.DATE,
  ]

  return {
    attachmentRunStyle: getAttachmentRunStyle(config),
    bodyRunStyle: getRunStyle(NodeType.PARAGRAPH, config),
    runStyles: Object.fromEntries(
      runNodeTypes.map((type) => [type, getRunStyle(type, config)]),
    ) as Record<NodeType, Partial<IRunOptions>>,
    paragraphStyles: Object.fromEntries(
      paragraphNodeTypes.map((type) => [type, getParagraphStyle(type, config)]),
    ) as Record<StaticParagraphType, Partial<IParagraphOptions>>,
    attachmentParagraphStyles: {
      single: getAttachmentParagraphStyle(false, false, config, false),
      singleNoSpacingBefore: getAttachmentParagraphStyle(false, false, config, true),
      multiFirst: getAttachmentParagraphStyle(true, true, config, false),
      multiFirstNoSpacingBefore: getAttachmentParagraphStyle(true, true, config, true),
      multiRest: getAttachmentParagraphStyle(true, false, config, false),
    },
    useCharacterIndent: new Set([
      NodeType.HEADING_1,
      NodeType.HEADING_2,
      NodeType.HEADING_3,
      NodeType.HEADING_4,
      NodeType.PARAGRAPH,
    ]),
  }
}

// ---- 无边框定义（用于版头表格） ----

const NO_BORDER: IBorderOptions = {
  style: BorderStyle.NONE,
  size: 0,
  color: 'FFFFFF',
}

const TABLE_NO_BORDERS = {
  top: NO_BORDER,
  bottom: NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
  insideHorizontal: NO_BORDER,
  insideVertical: NO_BORDER,
}

// ---- 页码样式 (GB/T 9704: 四号宋体, — X — 格式, 奇右偶左各空一字) ----

/** 页码一字线（Unicode EM DASH） */
const PAGE_NUM_DASH = '\u2014'

/** 页码距版心下边缘 7mm (GB/T 9704)，通过 spacing.before 定位 */
const PAGE_NUM_SPACING_BEFORE = cmToTwip(0.7) // 7mm = 0.7cm ≈ 397 twips

type PageNumberAlignment = typeof AlignmentType.LEFT | typeof AlignmentType.RIGHT | typeof AlignmentType.CENTER

interface PageNumberParagraphOptions {
  alignment: PageNumberAlignment
  indent: { left?: number; right?: number }
}

export function getPageNumberParagraphOptions(
  pageNumberStyle: PageNumberStyle,
  pageNumIndent: number,
): {
  evenAndOddHeaderAndFooters: boolean
  defaultOptions: PageNumberParagraphOptions
  evenOptions?: PageNumberParagraphOptions
} {
  if (pageNumberStyle === 'center') {
    return {
      evenAndOddHeaderAndFooters: false,
      defaultOptions: {
        alignment: AlignmentType.CENTER,
        indent: {},
      },
    }
  }

  return {
    evenAndOddHeaderAndFooters: true,
    defaultOptions: {
      alignment: AlignmentType.RIGHT,
      indent: { right: pageNumIndent },
    },
    evenOptions: {
      alignment: AlignmentType.LEFT,
      indent: { left: pageNumIndent },
    },
  }
}

/** 构建页码段落 */
function pageNumberParagraph(
  alignment: PageNumberAlignment,
  indent: { left?: number; right?: number },
  pageNumFont: Record<string, string>,
  pageNumSize: number,
): Paragraph {
  return new Paragraph({
    alignment,
    indent,
    spacing: { before: PAGE_NUM_SPACING_BEFORE },
    children: [
      new TextRun({ font: pageNumFont, size: pageNumSize, children: [PAGE_NUM_DASH + ' '] }),
      new TextRun({ font: pageNumFont, size: pageNumSize, children: [PageNumber.CURRENT] }),
      new TextRun({ font: pageNumFont, size: pageNumSize, children: [' ' + PAGE_NUM_DASH] }),
    ],
  })
}

function ensureChinesePeriod(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  return /[。！？!?]$/.test(trimmed) ? trimmed : `${trimmed}。`
}

/**
 * 拆分正文首句加粗：首句（到第一个"。"）加粗
 */
function splitBoldFirstSentence(content: string, runStyle: Partial<IRunOptions>): TextRun[] {
  const idx = content.indexOf('。')
  if (idx === -1 || idx === content.length - 1) {
    return [new TextRun({ ...runStyle, text: content, bold: true })]
  }

  const firstSentence = content.slice(0, idx + 1)
  const rest = content.slice(idx + 1)

  return [
    new TextRun({ ...runStyle, text: firstSentence, bold: true }),
    new TextRun({ ...runStyle, text: rest }),
  ]
}

/** 将 AST 节点中的 runs 转换为 docx TextRun 数组，合并基础样式和 run 自身样式 */
function runsToTextRuns(
  runs: RichTextRun[],
  baseRunStyle: Partial<IRunOptions>,
): TextRun[] {
  return runs
    .filter((run) => run.text.length > 0)
    .map((run) => {
      return new TextRun(buildRunStyleOverride(baseRunStyle, run))
    })
}

/**
 * 将附件说明节点转换为 DOCX 段落
 *
 * 单附件模式：附件：xxx
 * 多附件模式：附件：1.xxx
 *                   2.xxx
 *                   3.xxx
 */
function attachmentToParagraphs(
  node: AttachmentNode,
  cache: BuildStyleCache,
  config: DocumentConfig,
  omitSpacingBefore = false,
): Paragraph[] {
  const paragraphs: Paragraph[] = []
  const runStyle = cache.attachmentRunStyle
  if (node.layoutLine) {
    const styles = cache.attachmentParagraphStyles
    const base = node.layoutLine === 'item' ? styles.multiRest : node.layoutLine === 'first'
      ? (omitSpacingBefore ? styles.multiFirstNoSpacingBefore : styles.multiFirst)
      : (omitSpacingBefore ? styles.singleNoSpacingBefore : styles.single)
    const alignment = node.alignment
      ? getParagraphStyle(NodeType.ATTACHMENT, config, undefined, undefined, false, false, node.alignment).alignment
      : base.alignment
    const position = (node.alignment && node.alignment !== 'justify') || node.noIndent
      ? { ...base, alignment, indent: { left: 0, right: 0 } }
      : { ...base, alignment }
    return [new Paragraph({
      ...shiftParagraph(position, (node.offsetChars || 0) * ptToTwip(config.body.fontSize)),
      children: node.runs?.length ? runsToTextRuns(node.runs, runStyle) : [new TextRun({ ...runStyle, text: node.content })],
    })]
  }

  if (!node.isMultiple) {
    // 单附件模式
    const paragraphStyle = omitSpacingBefore
      ? cache.attachmentParagraphStyles.singleNoSpacingBefore
      : cache.attachmentParagraphStyles.single
    paragraphs.push(
      new Paragraph({
        ...paragraphStyle,
        children: [
          new TextRun({ ...runStyle, text: '附件：' }),
          new TextRun({ ...runStyle, text: node.items[0].name }),
        ],
      })
    )
  } else {
    // 多附件模式
    node.items.forEach((item, index) => {
      const isFirst = index === 0
      const paragraphStyle = isFirst
        ? (omitSpacingBefore
          ? cache.attachmentParagraphStyles.multiFirstNoSpacingBefore
          : cache.attachmentParagraphStyles.multiFirst)
        : cache.attachmentParagraphStyles.multiRest

      if (isFirst) {
        // 第一个附件：附件：1.xxx
        paragraphs.push(
          new Paragraph({
            ...paragraphStyle,
            children: [
              new TextRun({ ...runStyle, text: '附件：' }),
              new TextRun({ ...runStyle, text: `${item.index}.${item.name}` }),
            ],
          })
        )
      } else {
        // 后续附件：2.xxx
        paragraphs.push(
          new Paragraph({
            ...paragraphStyle,
            children: [
              new TextRun({ ...runStyle, text: `${item.index}.${item.name}` }),
            ],
          })
        )
      }
    })
  }

  return paragraphs
}

// 仅保留大纲级别（导航窗格可用），不套用 Word 内置 Heading 样式，
// 避免其默认的「与下段同页 / 段中不分页」属性把长标题段整段推到下一页，
// 在页底留下大片空白。标题的字体字号行距均由直接格式显式控制。
function getWordHeadingOptions(nodeType: NodeType): Pick<IParagraphOptions, 'outlineLevel'> | undefined {
  switch (nodeType) {
    case NodeType.HEADING_1:
      return { outlineLevel: 0 }
    case NodeType.HEADING_2:
      return { outlineLevel: 1 }
    case NodeType.HEADING_3:
      return { outlineLevel: 2 }
    case NodeType.HEADING_4:
      return { outlineLevel: 3 }
    default:
      return undefined
  }
}

export function getWordHeadingMeta(nodeType: NodeType): Pick<IParagraphOptions, 'outlineLevel'> | undefined {
  return getWordHeadingOptions(nodeType)
}

function shiftParagraph(style: Partial<IParagraphOptions>, offset: number): Partial<IParagraphOptions> {
  if (!offset) return style
  return {
    ...style,
    indent: {
      ...style.indent,
      left: (typeof style.indent?.left === 'number' ? style.indent.left : 0) + offset,
      right: (typeof style.indent?.right === 'number' ? style.indent.right : 0) - offset,
    },
  }
}

/** 将单个 AST 节点转换为 docx Paragraph */
function nodeToParagraph(
  node: DocumentNode,
  config: DocumentConfig,
  cache: BuildStyleCache,
  spacingBefore = 0,
  signatureContent?: string,
  dateContent?: string
): Paragraph {
  let paragraphStyle =
    node.type === NodeType.SIGNATURE || node.alignment || node.noIndent
      ? getParagraphStyle(node.type, config, signatureContent, dateContent, false, false, node.alignment, node.noIndent)
      : cache.paragraphStyles[node.type as StaticParagraphType] ?? getParagraphStyle(node.type, config)
  const runStyle = cache.runStyles[node.type] ?? getRunStyle(node.type, config)
  const useCharacterIndent = cache.useCharacterIndent.has(node.type) &&
    !node.noIndent && (!node.alignment || node.alignment === 'justify')

  // 外部传入的额外 spacing.before（如版头后标题空二行）
  if (spacingBefore > 0) {
    paragraphStyle = {
      ...paragraphStyle,
      spacing: { ...paragraphStyle.spacing, before: spacingBefore },
    }
  }

  const offset = (node.offsetChars || 0) * ptToTwip(config.body.fontSize)
  const baseParagraphStyle = useCharacterIndent
    ? { ...paragraphStyle, indent: undefined }
    : shiftParagraph(paragraphStyle, offset)
  const wordHeadingOptions = node.type === NodeType.HEADING_3 && isDiscourseHeading(node.content)
    ? undefined
    : getWordHeadingOptions(node.type)

  function createParagraph(children: TextRun[]): Paragraph {
    const paragraph = new Paragraph({
      ...baseParagraphStyle,
      ...wordHeadingOptions,
      children,
    })

    if (useCharacterIndent) {
      (
        paragraph as unknown as {
          properties: {
            push: (item: ReturnType<typeof createCharacterFirstLineIndent>) => void
          }
        }
      ).properties.push(createCharacterFirstLineIndent(config, offset))
    }

    return paragraph
  }

  const styledRuns = hasRichStyleOverrides(node.runs) ? node.runs : undefined
  const spans = getHeadingSpans(node.content, node.type)
  if (spans.length > 0) {
    return createParagraph(sliceHeadingText(node.content, spans, styledRuns).flatMap(({ text, type, runs }) => {
      const base = type ? cache.runStyles[type] : cache.bodyRunStyle
      return runs ? runsToTextRuns(runs, base) : [new TextRun({ ...base, text })]
    }))
  }

  if (styledRuns) {
    return createParagraph(runsToTextRuns(styledRuns, runStyle))
  }

  // 正文首句加粗
  if (node.type === NodeType.PARAGRAPH && config.specialOptions.boldFirstSentence) {
    return createParagraph(splitBoldFirstSentence(node.content, runStyle))
  }

  return createParagraph([
    new TextRun({
      ...runStyle,
      text: node.content,
    }),
  ])
}

/** 将完整 GongwenAST 转换为 docx Document */
export function buildDocument(ast: GongwenAST, config: DocumentConfig): Document {
  const children: (Paragraph | Table)[] = []
  const cache = createBuildStyleCache(config)

  // ---- 版头段落 ----
  // 便签模式：版头放页眉（距页顶 30mm），字体方正大标宋；正文直接从红线开始
  let noteHeaderParagraph: Paragraph | null = null
  if (config.header.enabled && config.header.orgName) {
    const isFormal = config.header.mode === 'formal'
    const headerFont = {
      ascii: 'Times New Roman',
      eastAsia: config.body.fontFamily,
      hAnsi: 'Times New Roman',
      cs: 'Times New Roman',
    }
    const headerFontSize = config.body.fontSize * 2
    // "空一字"缩进量 = 1 个字号宽度（使用数字 twips，在表格单元格内最可靠）
    const oneCharIndent = ptToTwip(config.body.fontSize)
    const orgDisplayName = isFormal ? `${config.header.orgName}文件` : config.header.orgName

    // 1. 发文机关标志：红色大字，分散对齐撑满版心，字号按名称长度计算（GB/T 9704 7.2.4）
    const orgChars = Array.from(orgDisplayName).length
    const availableMm = 210 - config.margins.left * 10 - config.margins.right * 10
    const headerOrgSizePt = Math.max(18, Math.min(30, Math.floor((availableMm * 72 / 25.4) / orgChars)))
    const noteHeaderFont = {
      ascii: 'Times New Roman',
      eastAsia: '方正大标宋',
      hAnsi: 'Times New Roman',
      cs: 'Times New Roman',
    }
    if (isFormal) {
      children.push(new Paragraph({
        alignment: AlignmentType.DISTRIBUTE,
        spacing: { line: ptToTwip(headerOrgSizePt * 1.2), lineRule: LineRuleType.EXACT },
        children: [new TextRun({
          text: orgDisplayName,
          font: { ascii: 'Times New Roman', eastAsia: '方正小标宋_GBK', hAnsi: 'Times New Roman', cs: 'Times New Roman' },
          size: headerOrgSizePt * 2,
          color: 'E00000',
        })],
      }))
    } else {
      // 便签：版头放页眉，不占用正文流
      noteHeaderParagraph = new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({
          text: orgDisplayName,
          font: noteHeaderFont,
          size: headerOrgSizePt * 2,
          color: 'E00000',
        })],
      })
    }

    // 发文机关标志下空二行（仅正式文件；便签直接接红线）
    const bodyLineSpacing = ptToTwip(config.body.lineSpacing)
    if (isFormal) {
      for (let i = 0; i < 2; i++) {
        children.push(new Paragraph({
          spacing: { line: bodyLineSpacing, lineRule: LineRuleType.EXACT, before: 0, after: 0 },
          children: [new TextRun({ font: headerFont, size: headerFontSize, text: '' })],
        }))
      }
    }

    // 2. 发文字号 / 签发人（仅正式文件；位于红线之上）
    if (isFormal) {
    if (config.header.signer) {
      // 有签发人：无边框表格 — 字号居左空一字，签发人居右空一字
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: TABLE_NO_BORDERS,
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                borders: TABLE_NO_BORDERS,
                children: [new Paragraph({
                  alignment: AlignmentType.LEFT,
                  indent: { left: oneCharIndent },
                  children: [new TextRun({
                    text: config.header.docNumber,
                    font: headerFont,
                    size: headerFontSize,
                  })],
                })],
              }),
              new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                borders: TABLE_NO_BORDERS,
                children: [new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  indent: { right: oneCharIndent },
                  children: [
                    // "签发人："三字用三号仿宋体
                    new TextRun({
                      text: '签发人：',
                      font: headerFont,
                      size: headerFontSize,
                    }),
                    // 签发人姓名用三号楷体
                    new TextRun({
                      text: config.header.signer,
                      font: { ...headerFont, eastAsia: '楷体_GB2312' },
                      size: headerFontSize,
                    }),
                  ],
                })],
              }),
            ],
          }),
        ],
      }))
    } else if (config.header.docNumber) {
      // 无签发人：发文字号居中
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({
          text: config.header.docNumber,
          font: headerFont,
          size: headerFontSize,
        })],
      }))
    }
    } // end isFormal

    // 3. 红色分隔线：单条红线（发文字号之下）
    children.push(new Paragraph({
      spacing: { before: 80, after: 0 },
      border: {
        bottom: {
          style: BorderStyle.SINGLE,
          size: 15, // ~1.9pt ≈ 标准红线粗细
          color: 'E00000',
          space: 1,
        },
      },
      children: [],
    }))
  }

  // 版头启用时，标题需通过 spacing.before 空二行（56pt = 1120 twips）
  const titleSpacingBefore = (config.header.enabled && config.header.orgName)
    ? ptToTwip(config.body.lineSpacing * 2)
    : 0

  if (ast.title) {
    const lines = getTitleLines(ast.title)
    lines.forEach((line, idx) => {
      children.push(nodeToParagraph(
        line,
        config,
        cache,
        idx === 0 ? titleSpacingBefore : 0,
      ))
    })
  }

  const titleMetadata = getTitleMetadataIndices(ast, config.specialOptions.hasTitleNameDate)
  const bodyLineSpacing = ptToTwip(config.body.lineSpacing)
  const nameDateFont = {
    ascii: 'Times New Roman',
    eastAsia: '楷体_GB2312',
    hAnsi: '楷体_GB2312',
    cs: '楷体_GB2312',
  }
  const nameDateFontSize = config.body.fontSize * 2 // 三号 = body fontSize * 2 half-points

  for (let i = 0; i < ast.body.length; i++) {
    const node = ast.body[i]
    const isFirstBodyNode = i === 0
    
    const isTitleDate = i === titleMetadata.date || i === titleMetadata.byline
    if (i === titleMetadata.name || isTitleDate) {
      const text = isTitleDate ? readTitleByline(node.content) ?? ensureTitleDateParentheses(node.content) : node.content
      const style = { font: nameDateFont, size: nameDateFontSize }
      children.push(new Paragraph({
        ...shiftParagraph(getParagraphStyle(node.type, config, undefined, undefined, isTitleDate,
          i === titleMetadata.name, node.alignment, node.noIndent), (node.offsetChars || 0) * ptToTwip(config.body.fontSize)),
        children: node.runs && hasRichStyleOverrides(node.runs)
          ? runsToTextRuns(node.runs, style)
          : [new TextRun({ ...style, text })],
      }))
      continue
    }
    
    // 与预览保持相同的署名前行距。
    if (node.type === NodeType.SIGNATURE && !ast.layoutEditable) {
      const bodyFont = {
        ascii: 'Times New Roman',
        eastAsia: config.body.fontFamily,
        hAnsi: config.body.fontFamily,
        cs: 'Times New Roman',
      }
      const bodyFontSize = config.body.fontSize * 2
      
      for (let j = 0; j < (config.specialOptions.hasStamp ? 3 : 1); j++) {
        children.push(new Paragraph({
          spacing: { line: bodyLineSpacing, lineRule: LineRuleType.EXACT, before: 0, after: 0 },
          children: [new TextRun({ font: bodyFont, size: bodyFontSize, text: '' })],
        }))
      }
    }
    
    // 附件说明特殊处理
    if (node.type === NodeType.ATTACHMENT) {
      const attachmentParagraphs = attachmentToParagraphs(
        node as AttachmentNode,
        cache,
        config,
        isFirstBodyNode,
      )
      children.push(...attachmentParagraphs)
      continue
    }
    
    // 对于 SIGNATURE 节点，查找下一个节点是否为 DATE
    if (node.type === NodeType.SIGNATURE && i + 1 < ast.body.length && ast.body[i + 1].type === NodeType.DATE) {
      children.push(nodeToParagraph(node, config, cache, 0, node.content, ast.body[i + 1].content))
    } else {
      children.push(nodeToParagraph(node, config, cache))
    }
  }

  // ---- 落款（发文机关署名 + 成文日期） ----
  const { name: nameText, date: dateText } = getSupplementalSignature(ast, config.specialOptions)
  if (nameText || dateText) {
    const bodyFont = {
      ascii: 'Times New Roman',
      eastAsia: config.body.fontFamily,
      hAnsi: config.body.fontFamily,
      cs: 'Times New Roman',
    }
    const bodyFontSize = config.body.fontSize * 2
    const oneCharWidth = ptToTwip(config.body.fontSize)
    const runOptions = { font: bodyFont, size: bodyFontSize }

    // 落款前空三行（距最后一行公文正文）
    for (let j = 0; j < 3; j++) {
      children.push(new Paragraph({
        spacing: { line: bodyLineSpacing, lineRule: LineRuleType.EXACT, before: 0, after: 0 },
        children: [new TextRun({ font: bodyFont, size: bodyFontSize, text: '' })],
      }))
    }

    // 署名右空 4 字（日期长于署名 2 字以上则 5 字），日期居中于署名（中线对齐）
    const estimateEm = (t: string) => {
      let w = 0
      for (const c of t) w += /[\u4e00-\u9fff\uff01-\uff5e\u3000-\u303f]/.test(c) ? 1 : 0.5
      return w
    }
    const dateW = dateText ? estimateEm(dateText) : 0
    const nameW = nameText ? estimateEm(nameText) : 0
    const dateIndentChars = dateW > nameW + 2 ? 5 : 4
    const nameIndentChars = Math.max(0, dateIndentChars + (dateW - nameW) / 2)

    // 发文机关署名
    if (nameText) children.push(new Paragraph({
      alignment: AlignmentType.RIGHT,
      indent: { right: Math.round(oneCharWidth * nameIndentChars) },
      spacing: { line: bodyLineSpacing, lineRule: LineRuleType.EXACT, before: 0, after: 0 },
      children: [new TextRun({ ...runOptions, text: nameText })],
    }))

    // 成文日期（不添加括号）：在署名右空基础上向左微调 0.5 字，
    // 补偿仿宋中阿拉伯数字实际宽度大于 0.5em 估算造成的视觉左偏
    if (dateText) children.push(new Paragraph({
      alignment: AlignmentType.RIGHT,
      indent: { right: Math.max(0, Math.round(oneCharWidth * (dateIndentChars - 0.5))) },
      spacing: { line: bodyLineSpacing, lineRule: LineRuleType.EXACT, before: 0, after: 0 },
      children: [new TextRun({ ...runOptions, text: dateText })],
    }))
  }

  // ---- 版记浮动表格（锚定页面底部版心下边缘） ----
  // 使用 Table Float 将版记吸附到最后一页底部，
  // 无需计算空行填充，Word 引擎自动处理文本避让。
  if (config.footerNote.enabled) {
    const bodyFont = {
      ascii: 'Times New Roman',
      eastAsia: config.body.fontFamily,
      hAnsi: config.body.fontFamily,
      cs: 'Times New Roman',
    }
    const footerNoteSize = 28 // 四号 14pt = 28 half-point
    // 使用 twips 数值（表格内段落缩进更可靠）
    const fnOneCharIndent = ptToTwip(config.body.fontSize)

    // 粗线（首条、末条分隔线）
    const thickBorder: IBorderOptions = {
      style: BorderStyle.SINGLE,
      size: 8, // 约 0.35mm
      color: '000000',
    }
    // 细线（抄送与印发之间的分隔线）
    const thinBorder: IBorderOptions = {
      style: BorderStyle.SINGLE,
      size: 6, // 约 0.25mm
      color: '000000',
    }

    const hasCc = !!config.footerNote.cc
    const hasPrint = !!(config.footerNote.printer || config.footerNote.printDate)
    const footerRows: TableRow[] = []

    if (hasCc) {
      footerRows.push(new TableRow({
        children: [
          new TableCell({
            columnSpan: 2,
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            children: [new Paragraph({
              alignment: AlignmentType.LEFT,
              indent: {
                left: fnOneCharIndent * 4,
                hanging: fnOneCharIndent * 3,
                right: fnOneCharIndent,
              },
              spacing: { line: bodyLineSpacing, lineRule: LineRuleType.EXACT, before: 0, after: 0 },
              children: [new TextRun({
                text: `抄送：${ensureChinesePeriod(config.footerNote.cc)}`,
                font: bodyFont,
                size: footerNoteSize,
              })],
            })],
          }),
        ],
      }))
    }

    if (hasPrint) {
      const printerText = config.footerNote.printer || ''
        const dateText = config.footerNote.printDate
          ? `${normalizeDocumentDate(config.footerNote.printDate) ?? config.footerNote.printDate}印发`
        : ''

      footerRows.push(new TableRow({
        children: [
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            children: [new Paragraph({
              alignment: AlignmentType.LEFT,
              indent: { left: fnOneCharIndent },
              spacing: { line: bodyLineSpacing, lineRule: LineRuleType.EXACT, before: 0, after: 0 },
              children: printerText
                ? [new TextRun({ text: printerText, font: bodyFont, size: footerNoteSize })]
                : [],
            })],
          }),
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              indent: { right: fnOneCharIndent },
              spacing: { line: bodyLineSpacing, lineRule: LineRuleType.EXACT, before: 0, after: 0 },
              children: dateText
                ? [new TextRun({ text: dateText, font: bodyFont, size: footerNoteSize })]
                : [],
            })],
          }),
        ],
      }))
    }

    if (footerRows.length === 0) {
      footerRows.push(new TableRow({
        children: [
          new TableCell({
            columnSpan: 2,
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            children: [new Paragraph({ spacing: { before: 0, after: 0 }, children: [] })],
          }),
        ],
      }))
    }

    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: [5000, 5000],
      borders: {
        top: thickBorder,
        bottom: thickBorder,
        left: NO_BORDER,
        right: NO_BORDER,
        insideHorizontal: hasCc && hasPrint ? thinBorder : NO_BORDER,
        insideVertical: NO_BORDER,
      },
      float: {
        horizontalAnchor: TableAnchorType.MARGIN,
        verticalAnchor: TableAnchorType.MARGIN,
        relativeHorizontalPosition: RelativeHorizontalPosition.LEFT,
        relativeVerticalPosition: RelativeVerticalPosition.BOTTOM,
        overlap: OverlapType.NEVER,
      },
      rows: footerRows,
    }))
  }

  // 页码字体：四号宋体（中英文统一宋体，14pt = 28 half-point）
  const pageNumFont = {
    ascii: '宋体',
    eastAsia: '宋体',
    hAnsi: '宋体',
    cs: '宋体',
  }
  const pageNumSize = 28 // 四号 14pt
  // 奇偶页各空一字（四号字 14pt = 280 twips）
  const pageNumIndent = ptToTwip(14)
  const pageNumberOptions = getPageNumberParagraphOptions(config.specialOptions.pageNumberStyle, pageNumIndent)

  // 页脚配置：默认国标单右双左，也支持全居中；支持首页无页码
  const footers: any = {}
  let evenAndOddHeaderAndFooters = false

  if (config.specialOptions.showPageNumber) {
    evenAndOddHeaderAndFooters = pageNumberOptions.evenAndOddHeaderAndFooters

    footers.default = new Footer({
      children: [
        pageNumberParagraph(
          pageNumberOptions.defaultOptions.alignment,
          pageNumberOptions.defaultOptions.indent,
          pageNumFont,
          pageNumSize,
        ),
      ],
    })

    if (pageNumberOptions.evenOptions) {
      footers.even = new Footer({
        children: [
          pageNumberParagraph(
            pageNumberOptions.evenOptions.alignment,
            pageNumberOptions.evenOptions.indent,
            pageNumFont,
            pageNumSize,
          ),
        ],
      })
    }

    if (config.specialOptions.firstPageNoNumber) {
      footers.first = new Footer({
        children: [],
      })
    }
  }

  return new Document({
    // 国标样式启用奇偶页不同页脚；全居中时关闭
    evenAndOddHeaderAndFooters,
    sections: [
      {
        properties: {
          // 首页无页码：启用首页独立页脚（first footer 为空）
          titlePage: config.specialOptions.showPageNumber && config.specialOptions.firstPageNoNumber,
          page: {
            size: {
              width: 11906, // A4: 210mm
              height: 16838, // A4: 297mm
            },
            margin: {
              top: cmToTwip(config.margins.top),
              bottom: cmToTwip(config.margins.bottom),
              left: cmToTwip(config.margins.left),
              right: cmToTwip(config.margins.right),
              // 便签模式：页眉距页顶 30mm（GB/T 9704 10.1 信函格式）
              ...(noteHeaderParagraph ? { header: cmToTwip(3.0) } : {}),
            },
          },
        },
        // 便签模式：版头放页眉
        ...(noteHeaderParagraph
          ? { headers: { default: new Header({ children: [noteHeaderParagraph] }) } }
          : {}),
        footers: Object.keys(footers).length > 0 ? footers : undefined,
        children,
      },
    ],
  })
}
