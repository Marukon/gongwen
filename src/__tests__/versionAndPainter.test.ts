// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { parseGongwen } from '../parser/parser'
import { removeMeaninglessLineBreaks } from '../utils/sanitize'

describe('Subtitle and Author Name separation', () => {
  it('does not merge author name into subtitle even during aggressive line-break cleaning', () => {
    const input = [
      '在“上传下达”中走好新时代群众路线',
      '——学习关于基层工作方法重要论述体会',
      '李四',
      '2026年8月28日',
    ].join('\n')

    const cleaned = removeMeaninglessLineBreaks(input).text
    const lines = cleaned.split('\n')
    expect(lines.length).toBe(4)
    expect(lines[0]).toBe('在“上传下达”中走好新时代群众路线')
    expect(lines[1]).toBe('——学习关于基层工作方法重要论述体会')
    expect(lines[2]).toBe('李四')
    expect(lines[3]).toBe('2026年8月28日')
  })

  it('correctly parses subtitle into title and keeps author name and date in body', () => {
    const raw = [
      '在“上传下达”中走好新时代群众路线',
      '——学习关于基层工作方法重要论述体会',
      '王五',
      '2026年8月28日',
      '一、总体要求',
      '必须坚持实事求是。',
    ].join('\n')

    const ast = parseGongwen(raw)
    expect(ast.title).not.toBeNull()
    expect(ast.title!.content).toBe('在“上传下达”中走好新时代群众路线\n——学习关于基层工作方法重要论述体会')
    expect(ast.body[0].content).toBe('王五')
    expect(ast.body[1].content).toBe('2026年8月28日')
  })
})

describe('工具栏版本', () => {
  it('编辑次数变化时保留完整程序版本', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { Toolbar } = await import('../components/Toolbar/Toolbar')
    const render = (draftRevision: number) => renderToStaticMarkup(createElement(Toolbar, {
      ast: { title: null, body: [] }, onClear() {}, onImport() {}, onExport() {}, draftRevision,
    }))
    expect(render(2)).toContain(__APP_VERSION__ + ' · 草稿修订 2')
    expect(render(3)).toContain(__APP_VERSION__ + ' · 草稿修订 3')
  })
})

describe('parseRichGongwen handles format painter HTML', () => {
  it('parses spans at root level or nested inside paragraphs', async () => {
    const { parseRichGongwen } = await import('../parser/richParser')
    // Scenario 1: span wrapped around text inside paragraph
    const html1 = '<p class="a4-title">这是公文标题</p><p class="a4-paragraph"><span style="font-family: FangSong; font-size: 16pt;">被刷格式的文字</span>正常文字</p>'
    const ast1 = parseRichGongwen(html1)
    expect(ast1.body[0].content).toBe('被刷格式的文字正常文字')
    expect(ast1.body[0].runs?.[0]).toMatchObject({ text: '被刷格式的文字', fontFamily: '仿宋_GB2312', fontSize: 16 })

    // Scenario 2: span inserted at root level (extracted contents)
    const html2 = '<p class="a4-title">这是公文标题</p><span style="font-family: FangSong; font-size: 16pt;">被刷格式的文字</span><p class="a4-paragraph">正常文字</p>'
    const ast2 = parseRichGongwen(html2)
    expect(ast2.body.some(b => b.content.includes('被刷格式的文字'))).toBe(true)
  })

  it('exports manual rich runs to docx without losing text or formatting even with boldFirstSentence', async () => {
    const { buildDocument } = await import('../exporter/docxBuilder')
    const { DEFAULT_CONFIG } = await import('../types/documentConfig')
    const { NodeType } = await import('../types/ast')
    const { Packer } = await import('docx')
    const JSZip = (await import('jszip')).default

    const config = {
      ...DEFAULT_CONFIG,
      specialOptions: { ...DEFAULT_CONFIG.specialOptions, boldFirstSentence: true },
    }

    const ast = {
      title: { type: NodeType.DOCUMENT_TITLE, content: '测试标题', lineNumber: 1 },
      body: [
        {
          type: NodeType.PARAGRAPH,
          content: '被刷格式的文字和后续普通文字。',
          lineNumber: 2,
          runs: [
            { text: '被刷格式的文字', bold: true, fontFamily: '黑体', fontSize: 16 },
            { text: '和后续普通文字。' },
          ],
        },
      ],
    }

    const doc = buildDocument(ast, config)
    const buf = await Packer.toBuffer(doc)
    const zip = await JSZip.loadAsync(buf)
    const xml = await zip.file('word/document.xml')!.async('string')

    expect(xml).toContain('被刷格式的文字')
    expect(xml).toContain('和后续普通文字。')
    expect(xml).toContain('黑体')
  })
})
