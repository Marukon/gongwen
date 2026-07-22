import { describe, it, expect } from 'vitest'
import { parseParsedLines, parseGongwen } from '../parser/parser'
import type { ParsedLineInput } from '../parser/parser'
import { astToStyledHtml } from '../utils/richText'
import { buildDocument } from '../exporter/docxBuilder'
import { DEFAULT_CONFIG, type DocumentConfig } from '../types/documentConfig'
import { getTitleRole, ensureTitleDateParentheses } from '../components/Preview/A4Page'
import { NodeType, type DocumentNode } from '../types/ast'

function docNode(content: string): DocumentNode {
  return { type: NodeType.PARAGRAPH, content, lineNumber: 1 }
}

function linesFromText(text: string): ParsedLineInput[] {
  return text.split('\n').map((text, i) => ({ text, lineNumber: i + 1 }))
}

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
})

describe('A4Page: 有人名日期 gating (mirrors richText/docxBuilder)', () => {
  const title = docNode('关于XX工作的通知')

  it('checked: index0=name, index1=date, index2=null', () => {
    expect(getTitleRole(docNode('张三'), 0, title, true)).toBe('name')
    expect(getTitleRole(docNode('2024年1月1日'), 1, title, true)).toBe('date')
    expect(getTitleRole(docNode('一、总体要求'), 2, title, true)).toBeNull()
  })

  it('unchecked: everything is body (no regex auto-detection)', () => {
    expect(getTitleRole(docNode('张三'), 0, title, false)).toBeNull()
    expect(getTitleRole(docNode('2024年1月1日'), 1, title, false)).toBeNull()
  })

  it('no title: never name/date', () => {
    expect(getTitleRole(docNode('张三'), 0, null, true)).toBeNull()
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
