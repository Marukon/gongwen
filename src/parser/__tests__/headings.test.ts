import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Packer } from 'docx'
import JSZip from 'jszip'
import { renderA4Content } from '../../components/Preview/A4Page'
import { buildDocument } from '../../exporter/docxBuilder'
import { NodeType } from '../../types/ast'
import { DEFAULT_CONFIG } from '../../types/documentConfig'
import { astToStyledHtml } from '../../utils/richText'
import { sanitizeText } from '../../utils/sanitize'
import { getHeadingSpans, sliceHeadingText } from '../headings'
import { detectNodeType } from '../matchers'
import { parseGongwen } from '../parser'

describe('公文标题与段内分项', () => {
  it.each([
    ['一百零一、 补充事项', NodeType.HEADING_1],
    ['一　、 总体要求', NodeType.HEADING_1],
    ['（ 二 ）分步实施', NodeType.HEADING_2],
    ['１２．完善制度', NodeType.HEADING_3],
    ['（ １ ）落实计划', NodeType.HEADING_4],
    ['一 是建立台账', NodeType.HEADING_3],
    ['1.5万元用于培训。', NodeType.PARAGRAPH],
    ['３．１４为近似值。', NodeType.PARAGRAPH],
    ['三要素缺一不可。', NodeType.PARAGRAPH],
    ['这是第一项。', NodeType.PARAGRAPH],
  ])('识别 %s', (text, type) => {
    expect(detectNodeType(text)).toBe(type)
  })

  it('短标题后有冒号时仍保留标题层级；引导句不挤占主送机关', () => {
    const text = '工作报告\n有关安排如下：\n（ 二 ）任务要求：\n一 是完善制度：\n各有关单位：'
    const ast = parseGongwen(sanitizeText(text).text)
    expect(ast.body.map((node) => node.type)).toEqual([
      NodeType.PARAGRAPH, NodeType.HEADING_2, NodeType.HEADING_3, NodeType.ADDRESSEE,
    ])
  })

  it.each(['；', '，'])('识别由 %s 分隔的连续分项，保留全部正文与标点', (separator) => {
    const content = `主要有三点：一是建好台账，及时更新${separator} 二是落实责任${separator}三是检查进度。后续另行通知。`
    const pieces = sliceHeadingText(content, getHeadingSpans(content, NodeType.PARAGRAPH))
    expect(pieces.filter((part) => part.type).map((part) => part.text)).toEqual([
      `一是建好台账，及时更新${separator}`, `二是落实责任${separator}`, '三是检查进度。',
    ])
    expect(pieces.map((part) => part.text).join('')).toBe(content)
  })

  it('不把引语中的编号或孤立分项套用成标题', () => {
    expect(getHeadingSpans('会上引用：“一是落实；二是检查。”', NodeType.PARAGRAPH)).toEqual([])
    expect(getHeadingSpans('原文说：一是主要原因。其余另行分析。', NodeType.PARAGRAPH)).toEqual([])
    expect(getHeadingSpans('检查要点：一是归档；三是检查。', NodeType.PARAGRAPH)).toEqual([])
  })

  it('一级标题、段内「一要／二要」和后续正文可以共处一段', () => {
    const text = '一、工作要求：一要核对台账；二要落实责任。另行通知。'
    expect(sliceHeadingText(text, getHeadingSpans(text, NodeType.HEADING_1))).toEqual([
      { text: '一、工作要求：', type: NodeType.HEADING_1 },
      { text: '一要核对台账；', type: NodeType.HEADING_3 },
      { text: '二要落实责任。', type: NodeType.HEADING_3 },
      { text: '另行通知。' },
    ])
  })

  it('编辑、打印预览与 DOCX 的分项范围一致，手工对齐和字体局部覆盖', async () => {
    const ast = parseGongwen('工作报告\n一、引用“先归档。”后的说明！正文继续。\n一是建好台账；二是落实责任。后文。\n1.具体工作')
    ast.body[0].alignment = 'center'
    ast.body[0].noIndent = true
    ast.body[0].runs = [
      { text: '一、引用“先归档。”后的说明！' },
      { text: '正文继续。', italic: true },
    ]
    const edit = astToStyledHtml(ast, DEFAULT_CONFIG)
    const print = renderToStaticMarkup(renderA4Content({ ...DEFAULT_CONFIG.specialOptions, ...ast }))
    for (const html of [edit, print]) {
      expect(html).toMatch(/a4-h1-inline">(?:<span>)?一、引用“先归档。”后的说明！/)
      expect(html).toMatch(/a4-paragraph-inline"><span style="font-style:italic">正文继续。/)
      expect(html).toContain('a4-h3-inline a4-h3-inline--bold">一是建好台账；')
      expect(html).toContain('a4-h3-inline a4-h3-inline--bold">二是落实责任。')
      expect(html).toContain('a4-paragraph-inline">后文。')
    }
    const zip = await JSZip.loadAsync(await Packer.toBuffer(buildDocument(ast, DEFAULT_CONFIG)))
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml.match(/<w:outlineLvl /g)).toHaveLength(2)
    expect(xml).toMatch(/w:val="center"[\s\S]*?<w:t xml:space="preserve">一、引用“先归档。”后的说明！/)
    expect(xml).toMatch(/<w:i\/>[\s\S]*?<w:t xml:space="preserve">正文继续。/)
    expect(xml).toContain('一是建好台账；</w:t>')
    expect(xml).toContain('二是落实责任。</w:t>')
  })
})
