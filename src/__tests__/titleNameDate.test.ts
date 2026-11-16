import { describe, it, expect } from 'vitest'
import { parseParsedLines, parseGongwen } from '../parser/parser'
import type { ParsedLineInput } from '../parser/parser'
import { astToStyledHtml } from '../utils/richText'
import { buildDocument } from '../exporter/docxBuilder'
import { DEFAULT_CONFIG, type DocumentConfig } from '../types/documentConfig'
import { renderA4Content } from '../components/Preview/A4Page'
import { ensureTitleDateParentheses, formatShanghaiDocumentDate, getSupplementalSignature, getTitleMetadataIndices } from '../utils/documentDates'
import { renderToStaticMarkup } from 'react-dom/server'
import { NodeType, type DocumentNode } from '../types/ast'
import { sanitizeText } from '../utils/sanitize'

function docNode(content: string): DocumentNode {
  return { type: NodeType.PARAGRAPH, content, lineNumber: 1 }
}

function linesFromText(text: string): ParsedLineInput[] {
  return text.split('\n').map((text, i) => ({ text, lineNumber: i + 1 }))
}

it('备用落款日期默认留空，填写时以北京时间当天为准', () => {
  expect(DEFAULT_CONFIG.specialOptions.signatureDate).toBe('')
  expect(formatShanghaiDocumentDate(new Date('2026-01-06T15:59:59Z'))).toBe('2026年1月6日')
  expect(formatShanghaiDocumentDate(new Date('2026-01-06T16:00:00Z'))).toBe('2026年1月7日')
})

describe('Issue 2: empty paragraphs preserved (return deletion propagates)', () => {
  it('preserves empty lines as PARAGRAPH nodes when preserveEmptyLines=true', () => {
    const ast = parseParsedLines(linesFromText('标题\n\n正文一\n\n正文二'), true)
    expect(ast.title?.content).toBe('标题')
    // 两个空行应保留为 PARAGRAPH 节点
    expect(ast.body.map((n) => n.content)).toEqual(['', '正文一', '', '正文二'])
  })

  it('raw text path (preserveEmptyLines=false) still skips empty lines', () => {
    const ast = parseParsedLines(linesFromText('标题\n\n正文一\n\n正文二'), false)
    expect(ast.body.map((n) => n.content)).toEqual(['正文一', '正文二'])
  })

  it('缩进与空行不妨碍连续附件解析，文末空行不遮挡成文日期', () => {
    const ast = parseGongwen('工作通知\n正文。\n  附件：1.清单\r\n\r\n  2.计划\r\n示例市人民政府办公室\r\n2024年02月29日\r\n', { preserveEmptyLines: true })
    expect(ast.body.find((node) => node.type === NodeType.ATTACHMENT)).toMatchObject({
      items: [{ index: 1, name: '清单' }, { index: 2, name: '计划' }],
    })
    expect(ast.body.slice(-3).map((node) => [node.type, node.content])).toEqual([
      [NodeType.SIGNATURE, '示例市人民政府办公室'], [NodeType.DATE, '2024年2月29日'], [NodeType.PARAGRAPH, ''],
    ])
  })
})

describe('Issue 1: 有人名日期 checkbox', () => {
  const config: DocumentConfig = {
    ...DEFAULT_CONFIG,
    specialOptions: { ...DEFAULT_CONFIG.specialOptions, hasTitleNameDate: true },
  }
  const raw = '关于XX工作的通知\n张三\n2024年1月1日\n一、总体要求\n贯彻落实。'

  it('forces name (line2) + date (line3) and parenthesizes date in preview HTML', () => {
    const ast = parseGongwen(raw)
    const html = astToStyledHtml(ast, config)
    expect(html).toContain('a4-title-secondary') // 姓名
    expect(html).toContain('a4-title-date') // 日期
    expect(html).toContain('（2024年1月1日）') // 自动加括号
    expect(html).not.toContain('2024年1月1日<') // 裸日期不应出现
  })

  it('date already parenthesized is not double-wrapped', () => {
    const ast = parseGongwen('关于XX工作的通知\n张三\n（2024年1月1日）\n一、总体要求')
    const html = astToStyledHtml(ast, config)
    expect(html).toContain('（2024年1月1日）')
    expect(html.match(/（（/g)).toBeNull() // 不应双重括号
  })

  it('含副标题（破折号开头）时：副标题并入标题，姓名与日期正确识别', () => {
    const subtitleRaw = [
      '在“上传下达”中走好新时代群众路线',
      '——学习关于基层工作方法重要论述体会',
      '张三',
      '2026年8月28日',
      '一、总体要求',
      '抓好落实。',
    ].join('\n')
    const ast = parseGongwen(subtitleRaw)
    expect(ast.title).not.toBeNull()
    expect(ast.title!.content).toBe('在“上传下达”中走好新时代群众路线\n——学习关于基层工作方法重要论述体会')
    expect(ast.body[0].content).toBe('张三')
    expect(ast.body[1].content).toBe('2026年8月28日')

    const html = astToStyledHtml(ast, config)
    // 包含两个独立的 a4-title 段落
    expect(html).toContain('<p class="a4-title">在“上传下达”中走好新时代群众路线</p>')
    expect(html).toContain('<p class="a4-title">——学习关于基层工作方法重要论述体会</p>')
    // 姓名和日期类
    expect(html).toContain('a4-title-secondary')
    expect(html).toContain('张三')
    expect(html).toContain('a4-title-date')
    expect(html).toContain('（2026年8月28日）')
  })

  it('unchecked: line2 treated as body (no name/date classes)', () => {
    const ast = parseGongwen(raw)
    const html = astToStyledHtml(ast, DEFAULT_CONFIG)
    expect(html).not.toContain('a4-title-secondary')
    expect(html).not.toContain('（2024年1月1日）')
  })

  it('docx export reflects name/date styling when checkbox on', async () => {
    const ast = parseGongwen(raw)
    const doc = buildDocument(ast, config)
    const { Packer } = await import('docx')
    const JSZip = (await import('jszip')).default
    const buf = await Packer.toBuffer(doc)
    const zip = await JSZip.loadAsync(buf)
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('楷体') // 楷体字体应用于姓名/日期
    expect(xml).toContain('（2024年1月1日）') // 导出 word 中日期自动加括号
  })

  it('主副标题各自保留手工样式，保留一个成文日期并去掉前导零', async () => {
    const ast = parseParsedLines([
      { text: '工作报告', lineNumber: 1, runs: [{ text: '工作报告', bold: true }] },
      { text: '——年度工作回顾', lineNumber: 2, runs: [{ text: '——年度工作回顾', italic: true }] },
      { text: '正文。', lineNumber: 3 },
      { text: '2024年02月29日', lineNumber: 4, runs: [{ text: '2024年', bold: true }, { text: '02月29日' }] },
    ])
    const settings = { ...config, specialOptions: { ...config.specialOptions, signatureDate: '2026年1月1日' } }
    const signature = getSupplementalSignature(ast, settings.specialOptions)
    const html = renderToStaticMarkup(renderA4Content({ ...settings.specialOptions, ...ast, signatureDate: signature.date }))
    expect(html).toContain('style="font-weight:bold">工作报告</span>')
    expect(html).toContain('style="font-style:italic">——年度工作回顾</span>')
    expect(html).not.toContain('a4-title-secondary')
    expect(html).not.toContain('2026年1月1日')
    const { Packer } = await import('docx')
    const JSZip = (await import('jszip')).default
    const xml = await (await JSZip.loadAsync(await Packer.toBuffer(buildDocument(ast, settings))))
      .file('word/document.xml')!.async('string')
    expect(xml.match(/工作报告/g)).toHaveLength(1)
    expect(xml).toContain('——年度工作回顾')
    expect(xml).toContain('<w:i/>')
    expect(xml).toContain('2月29日')
    expect(xml).not.toContain('02月29日')
    expect(xml).not.toContain('2026年1月1日')
  })
})

describe('姓名、日期在编辑和分页预览中使用同一规则', () => {
  it.each([
    { lines: ['（张三 2026年10月15日）'], rendered: '（张三 2026年10月15日）', nameSeparate: false },
    { lines: ['张三', '2026年9月30日'], rendered: '（2026年9月30日）', nameSeparate: true },
  ])('不勾选也能识别带副标题和称呼的讲话稿日期：$rendered', async ({ lines, rendered, nameSeparate }) => {
    const raw = ['青年干部交流体会', '——立足本职服务发展', ...lines, '尊敬的各位领导、同志们：', '大家下午好！', '这是正文。'].join('\n\n')
    const ast = parseGongwen(sanitizeText(raw).text, { preserveEmptyLines: true })
    expect(ast.title?.content).toBe('青年干部交流体会\n——立足本职服务发展')
    for (const html of [astToStyledHtml(ast, DEFAULT_CONFIG), renderToStaticMarkup(renderA4Content({ ...DEFAULT_CONFIG.specialOptions, ...ast }))]) {
      expect(html).toContain(`<p class="a4-title-date">${rendered}</p>`)
      expect(html.includes('a4-title-secondary')).toBe(nameSeparate)
      expect(html).not.toContain('<p><br></p>')
    }
    const { Packer } = await import('docx')
    const JSZip = (await import('jszip')).default
    const settings = { ...DEFAULT_CONFIG, specialOptions: { ...DEFAULT_CONFIG.specialOptions, signatureDate: '2026年11月16日' } }
    const zip = await JSZip.loadAsync(await Packer.toBuffer(buildDocument(ast, settings)))
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain(rendered)
    expect(xml).not.toContain('2026年11月16日')
  })

  const sample = parseGongwen('工作报告\n\n张三\n\n(2024年02月09日)\n一、总体要求', { preserveEmptyLines: true })

  it('识别时跳过空行，分页预览统一使用全角括号并去除补零', () => {
    expect(getTitleMetadataIndices(sample, true)).toEqual({ name: 1, date: 3 })
    const html = renderToStaticMarkup(renderA4Content({ ...DEFAULT_CONFIG.specialOptions, ...sample, hasTitleNameDate: true }))
    expect(html).toContain('a4-title-secondary')
    expect(html).toContain('（2024年2月9日）')
  })

  it('未启用、无标题、或没有有效日期时保留正文角色', () => {
    expect(getTitleMetadataIndices(sample, false)).toEqual({ name: -1, date: -1 })
    expect(getTitleMetadataIndices({ ...sample, title: null }, true)).toEqual({ name: -1, date: -1 })
    const invalid = { title: sample.title, body: [docNode('张三'), docNode('2023年2月29日')] }
    expect(getTitleMetadataIndices(invalid, true)).toEqual({ name: -1, date: -1 })
  })

  it('ensureTitleDateParentheses adds full-width parens, no double-wrap', () => {
    expect(ensureTitleDateParentheses('2024年1月1日')).toBe('（2024年1月1日）')
    expect(ensureTitleDateParentheses('（2024年1月1日）')).toBe('（2024年1月1日）')
    expect(ensureTitleDateParentheses('2024年1月1日').match(/（（/)).toBeNull()
    expect(ensureTitleDateParentheses('张三')).toBe('张三')
  })
})

describe('「一是/二是/三是」识别为三级标题，加粗仅到第一个句号', () => {
  const config: DocumentConfig = {
    ...DEFAULT_CONFIG,
    specialOptions: { ...DEFAULT_CONFIG.specialOptions, boldFirstSentence: true },
  }

  it('普通段落只加粗首句', () => {
    const ast = parseGongwen('标题\n这是第一句话。这是第二句话。')
    const html = astToStyledHtml(ast, config)
    expect(html).toContain('<strong>这是第一句话。</strong>这是第二句话。')
  })

  it('「一是/二是/三是」为三级标题，只加粗到第一个句号', () => {
    const ast = parseGongwen('标题\n一是强化政治引领，当好排头兵。后续内容。\n二是聚焦中心大局。')
    const html = astToStyledHtml(ast, config)
    // 首句加粗
    expect(html).toContain('a4-h3-inline--bold">一是强化政治引领，当好排头兵。</span>')
    // 后续内容不加粗
    expect(html).toContain('a4-paragraph-inline">后续内容。</span>')
    // 不应整体加粗
    expect(html).not.toContain('a4-h3-inline--bold">一是强化政治引领，当好排头兵。后续内容。</span>')
  })

  it('「一是/二是/三是」在首句加粗关闭时仍为三级标题（只加粗首句）', () => {
    const ast = parseGongwen('标题\n一是强化政治引领，当好排头兵。后续内容。\n二是聚焦中心大局。')
    const html = astToStyledHtml(ast, DEFAULT_CONFIG)
    // boldHeading3 默认为 true，仍加粗首句
    expect(html).toContain('a4-h3-inline--bold">一是强化政治引领，当好排头兵。</span>')
    expect(html).toContain('a4-paragraph-inline">后续内容。</span>')
  })
})
