import { describe, expect, it } from 'vitest'
import { Packer } from 'docx'
import JSZip from 'jszip'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderA4Content } from '../../components/Preview/A4Page'
import { parseParsedLines, type ParsedLineInput } from '../../parser/parser'
import { NodeType } from '../../types/ast'
import { DEFAULT_CONFIG } from '../../types/documentConfig'
import { buildDocument } from '../docxBuilder'

async function documentXml(lines: Omit<ParsedLineInput, 'lineNumber'>[]) {
  const ast = parseParsedLines(lines.map((line, i) => ({ ...line, lineNumber: i + 1 })), true, true)
  const zip = await JSZip.loadAsync(await Packer.toBuffer(buildDocument(ast, DEFAULT_CONFIG)))
  return { ast, xml: await zip.file('word/document.xml')!.async('string') }
}

function paragraph(xml: string, text: string): string {
  return xml.split('</w:p>').find((part) => part.includes(`>${text}</w:t>`)) ?? ''
}

describe('版面编辑写入 Word', () => {
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
