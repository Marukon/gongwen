import { describe, expect, it } from 'vitest'
import { Packer } from 'docx'
import JSZip from 'jszip'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderA4Content } from '../../components/Preview/A4Page'
import { parseParsedLines, type ParsedLineInput } from '../../parser/parser'
import { NodeType } from '../../types/ast'
import { DEFAULT_CONFIG } from '../../types/documentConfig'
import { readOffset } from '../../utils/editorLayout'
import { buildDocument } from '../docxBuilder'

async function documentXml(lines: Omit<ParsedLineInput, 'lineNumber'>[], config = DEFAULT_CONFIG) {
  const ast = parseParsedLines(lines.map((line, i) => ({ ...line, lineNumber: i + 1 })), true, true)
  const zip = await JSZip.loadAsync(await Packer.toBuffer(buildDocument(ast, config)))
  return { ast, xml: await zip.file('word/document.xml')!.async('string') }
}

function paragraph(xml: string, text: string): string {
  return xml.split('</w:p>').find((part) => part.includes(`>${text}</w:t>`)) ?? ''
}

describe('版面编辑写入 Word', () => {
  it.each([
    { hasStamp: false, nameIndent: 2.915, dateIndent: 2, nameTwips: 918, dateTwips: 630 },
    { hasStamp: true, nameIndent: 4.915, dateIndent: 4, nameTwips: 1548, dateTwips: 1260 },
  ])('自动落款使用同一套右空规则（印章：$hasStamp）', async ({ hasStamp, nameIndent, dateIndent, nameTwips, dateTwips }) => {
    const specialOptions = { ...DEFAULT_CONFIG.specialOptions, hasStamp }
    const { ast, xml } = await documentXml([
      { text: '值班室测试员', layoutType: NodeType.SIGNATURE },
      { text: '2026年11月7日', layoutType: NodeType.DATE },
    ], { ...DEFAULT_CONFIG, specialOptions })
    const preview = renderToStaticMarkup(renderA4Content({ ...specialOptions, ...ast }))
    expect(preview).toContain(`* ${nameIndent})">值班室测试员`)
    expect(preview).toContain(`* ${dateIndent})">2026年11月7日`)
    expect(paragraph(xml, '值班室测试员')).toContain(`w:right="${nameTwips}"`)
    expect(paragraph(xml, '2026年11月7日')).toContain(`w:right="${dateTwips}"`)
  })

  it('设置里的备用落款也共用右空，Word 不再额外平移日期', async () => {
    const signatureName = '值班室测试员'
    const signatureDate = '2026年11月7日'
    const specialOptions = { ...DEFAULT_CONFIG.specialOptions, signatureName, signatureDate }
    const { ast, xml } = await documentXml([
      { text: '测试正文。', layoutType: NodeType.DOCUMENT_TITLE },
    ], { ...DEFAULT_CONFIG, specialOptions })
    const preview = renderToStaticMarkup(renderA4Content({ ...specialOptions, ...ast }))
    expect(preview).toContain('* 4.25)">值班室测试员')
    expect(preview).toContain('* 4)">2026年11月7日')
    expect(paragraph(xml, signatureName)).toContain('w:right="1339"')
    expect(paragraph(xml, signatureDate)).toContain('w:right="1260"')
  })

  it('落款与日期可以在 Word 中共用小数位移的居中轴', async () => {
    const centered = { alignment: 'center', noIndent: true, offsetChars: readOffset('8.37') } as const
    const { ast, xml } = await documentXml([
      { text: '值班室 测试员', layoutType: NodeType.SIGNATURE, ...centered },
      { text: '2026年11月7日', layoutType: NodeType.DATE, ...centered },
    ])

    const preview = renderToStaticMarkup(renderA4Content({ ...DEFAULT_CONFIG.specialOptions, ...ast }))
    expect(preview.match(/translateX\(calc\(var\(--body-size, 16pt\) \* 8\.37\)\)/g)).toHaveLength(2)
    for (const content of ['值班室 测试员', '2026年11月7日']) {
      const p = paragraph(xml, content)
      expect(p).toContain('<w:jc w:val="center"/>')
      expect(p).toContain('w:left="2678"')
      expect(p).toContain('w:right="-2678"')
    }
  })

  it.each([
    { indent: 4536, left: 4536, right: 0 },
    { indent: -2835, left: 0, right: 2835 },
  ])('相对居中使用 Word 段落的单侧缩进 $indent', async ({ indent, left, right }) => {
    const format = { alignment: 'center', noIndent: true, paragraphIndentTwips: indent } as const
    const name = '值班室测试员'
    const date = '2026年11月7日'
    const { ast, xml } = await documentXml([
      { text: name, layoutType: NodeType.SIGNATURE, ...format },
      { text: date, layoutType: NodeType.DATE, ...format },
    ])
    const preview = renderToStaticMarkup(renderA4Content({ ...DEFAULT_CONFIG.specialOptions, ...ast }))
    expect(preview).not.toContain('translateX')
    expect(preview.split(`padding-left:${left / 20}pt`).length - 1).toBe(2)
    expect(preview.split(`padding-right:${right / 20}pt`).length - 1).toBe(2)
    for (const text of [name, date]) {
      const p = paragraph(xml, text)
      expect(p).toContain('<w:jc w:val="center"/>')
      expect(p).toContain(`w:left="${left}"`)
      expect(p).toContain(`w:right="${right}"`)
      expect(p).not.toContain('w:firstLineChars')
    }
  })

  it('保持落款段的新顺序、水平位置，以及非末尾的日期与文本空格', async () => {
    const { ast, xml } = await documentXml([
      { text: '情况说明', layoutType: NodeType.DOCUMENT_TITLE },
      { text: '值班室 测试员', layoutType: NodeType.SIGNATURE, offsetChars: -1, alignment: 'right' },
      { text: '2026年11月7日', layoutType: NodeType.DATE },
      { text: '　请审示。　', runs: [{ text: '　请审示。　' }], alignment: 'left' },
    ])
    expect(ast.body.map((node) => node.type)).toEqual([NodeType.SIGNATURE, NodeType.DATE, NodeType.PARAGRAPH])
    expect(xml.match(/<w:p>/g)).toHaveLength(4)
    expect(xml.indexOf('值班室 测试员')).toBeLessThan(xml.indexOf('请审示。'))
    expect(paragraph(xml, '值班室 测试员')).toContain('w:left="-320"')
    expect(paragraph(xml, '值班室 测试员')).toContain('w:right="320"')
    expect(xml).toContain('　请审示。　</w:t>')
  })

  it('每条附件保留自己的缩进、对齐、字体和颜色；移动后的标题不被强行提回文首', async () => {
    const { ast, xml } = await documentXml([
      { text: '临时添加的正文。', offsetChars: 1 },
      { text: '版面中移动过的标题', layoutType: NodeType.DOCUMENT_TITLE, alignment: 'right' },
      { text: '附件：1.工作清单', attachmentLine: 'first' },
      { text: '2.情况说明', attachmentLine: 'item', alignment: 'center', noIndent: true,
        runs: [{ text: '2.' }, { text: '情况说明', italic: true, underline: true, color: 'B00020', fontFamily: '黑体', fontSize: 18 }] },
    ])
    expect(ast.title).toBeNull()
    expect(xml.indexOf('临时添加的正文。')).toBeLessThan(xml.indexOf('版面中移动过的标题'))
    const body = paragraph(xml, '临时添加的正文。')
    expect(body).toContain('w:firstLineChars="200"')
    expect(body).toContain('w:left="320"')
    expect(body).toContain('w:right="-320"')
    const attachment = paragraph(xml, '情况说明')
    for (const format of ['w:val="center"', 'w:eastAsia="黑体"', 'w:val="36"', '<w:i/>', 'w:u w:val="single"', 'w:val="B00020"']) {
      expect(attachment).toContain(format)
    }
    const preview = renderToStaticMarkup(renderA4Content({ ...DEFAULT_CONFIG.specialOptions, ...ast }))
    expect(preview).toContain('color:#B00020')
    expect(preview).toContain('translateX(calc(var(--body-size, 16pt) * 1))')
  })
})
