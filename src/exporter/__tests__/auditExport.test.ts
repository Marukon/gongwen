import { expect, it } from 'vitest'
import { Packer } from 'docx'
import JSZip from 'jszip'
import { DEFAULT_CONFIG } from '../../types/documentConfig'
import { getTitleLines, NodeType, type GongwenAST } from '../../types/ast'
import { buildDocument } from '../docxBuilder'
import { splitAstForLargeExport } from '../download'

const sample: GongwenAST = { layoutEditable: true,
  title: { type: NodeType.DOCUMENT_TITLE, content:'说明\n副标题', lineNumber:1,
    titleLines:[{content:'说明',lineNumber:1},{content:'副标题',lineNumber:2,runs:[{text:'副标题',bold:true}]}] },
  body: [{type:NodeType.PARAGRAPH,content:'正文。',lineNumber:3},
    {type:NodeType.SIGNATURE,content:'值班室高纪山',lineNumber:4},{type:NodeType.DATE,content:'2026年11月7日',lineNumber:5}] }

it.each([true, false])('便签版头仅在首页；首页无页码=%s，页码字体可配置', async firstPageNoNumber => {
  const config = structuredClone(DEFAULT_CONFIG)
  Object.assign(config.header,{enabled:true,mode:'note',orgName:'测试办公室'})
  Object.assign(config.specialOptions,{firstPageNoNumber,showPageNumber:true,pageNumberFont:'黑体'})
  const zip = await JSZip.loadAsync(await Packer.toBuffer(buildDocument(sample,config)))
  const doc = await zip.file('word/document.xml')!.async('string')
  const headers = [...doc.matchAll(/<w:headerReference\b[^>]+/g)].map(m=>m[0])
  expect(headers).toHaveLength(1)
  expect(headers[0]).toContain('w:type="first"')
  expect(doc).toContain('<w:titlePg')
  const rels = await zip.file('word/_rels/document.xml.rels')!.async('string')
  async function part(ref: string) {
    const id = ref.match(/r:id="([^"]+)"/)![1]
    const rel = rels.match(/<Relationship [^>]+/g)!.find(t=>t.includes('Id="'+id+'"'))!
    return zip.file('word/'+rel.match(/Target="([^"]+)"/)![1])!.async('string')
  }
  expect(await part(headers[0])).toContain('测试办公室')
  const footers = doc.match(/<w:footerReference\b[^>]+/g)!
  expect((await part(footers.find(f=>f.includes('w:type="first"'))!)).includes('PAGE')).toBe(!firstPageNoNumber)
  expect(await part(footers.find(f=>f.includes('w:type="default"'))!)).toContain('w:ascii="黑体"')
  const paragraphs = doc.match(/<w:p[ >][\s\S]*?<\/w:p>/g)!
  expect(paragraphs.find(p=>p.includes('值班室高纪山'))).toContain('<w:keepNext')
  expect(paragraphs.find(p=>p.includes('2026年11月7日'))).not.toContain('<w:keepNext')
})

it('分卷保留手工排版、标题的最后一行和富文本；署名日期不拆卷', () => {
  const parts = splitAstForLargeExport(sample, 2)
  expect(parts.map(p=>p.body.length)).toEqual([1,2])
  expect(parts[1].layoutEditable).toBe(true)
  const last = getTitleLines(parts[1].title!)[1]
  expect(last.content).toBe('副标题（第2部分/共2部分）')
  expect(last.runs?.map(r=>r.text).join('')).toBe(last.content)
  expect(last.runs?.[0].bold).toBe(true)
  expect(sample.title?.titleLines?.[1].content).toBe('副标题')
})
