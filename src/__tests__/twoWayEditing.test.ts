// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { editorHtmlToPlainText, normalizeEditorHtml, restoreLegacySpacers } from '../utils/richText'
import { syncSourceText } from '../utils/syncSourceText'
import { parseRichGongwen } from '../parser/richParser'
import { normalizeDocumentConfig } from '../utils/documentConfigHelpers'

describe('版面文字同步', () => {
  const raw = '发言稿\n张旭虎\n2026年09月30日\n\n原句, 保留格式。\n末段。'
  const display = '发言稿\n张旭虎\n（2026年9月30日）\n原句，保留格式。\n末段。'
  it('只改动用户编辑的位置，保留原始日期、标点和空行', () => {
    expect(syncSourceText(raw, display, display.replace('保留格式', '已更新'))).toBe(raw.replace('保留格式', '已更新'))
    expect(syncSourceText(raw, display, display)).toBe(raw)
    expect(syncSourceText(raw, display, display + '\n增补。')).toBe(raw + '\n增补。')
    expect(syncSourceText(raw, display, '')).toBe('')
  })
  it('反映段落增删、移动和空段，保留手动换行', () => {
    const read = editorHtmlToPlainText
    expect(read('<p>甲<br>乙</p><div><p>丙</p><p><br></p><p><b>丁</b>&nbsp;戊</p></div>')).toBe('甲\n乙\n丙\n\n丁 戊')
    expect(syncSourceText('题\n甲\n乙\n丙', '题\n甲\n乙\n丙', read('<p>题</p><p>丙</p><p>甲</p>'))).toBe('题\n丙\n甲')
  })
  it('自动印章空行随设置变化，左侧只接收用户输入的空段', () => {
    const html = '<p class="a4-title">说明</p><p data-auto-space="title"><br></p><p>正文。</p><p><br></p><p data-auto-space="signature"><br></p><p class="a4-signature">办公室</p><p class="a4-date">2026年11月7日</p>'
    expect(editorHtmlToPlainText(html)).toBe('说明\n正文。\n\n办公室\n2026年11月7日')
    expect(parseRichGongwen(html, true).body.length - parseRichGongwen(html, false).body.length).toBe(2)
    expect(editorHtmlToPlainText(normalizeEditorHtml('<p data-auto-space="signature">手写新增</p>'))).toBe('手写新增')
  })
  it('在自动留白处按回车，浏览器复制的空段作为手工空行同步', () => {
    const spacer = '<p data-auto-space="signature"><br></p>'
    const html = normalizeEditorHtml('<p>正文。</p>' + spacer.repeat(3) + '<p class="a4-signature">值班室</p>')
    expect(html.match(/data-auto-space/g)).toHaveLength(1)
    expect(editorHtmlToPlainText(html)).toBe('正文。\n\n\n值班室')
    expect(parseRichGongwen(html, true).body.length - parseRichGongwen(html, false).body.length).toBe(2)
  })
  it('升级旧稿仅识别确定的自动空段，保留文字、加粗及额外空段', () => {
    const ref = '<p class="a4-title">说明</p><p data-auto-space="title"><br></p><p>正文。</p><p data-auto-space="signature"><br></p><p class="a4-signature">值班室</p>'
    const old = ref.replaceAll(/ data-auto-space="[^"]+"/g, '').replace('正文。', '<b>更新。</b>')
    const next = restoreLegacySpacers(old,ref,false)
    expect(next).toContain('<b>更新。</b>')
    expect(editorHtmlToPlainText(next)).toBe('说明\n更新。\n值班室')
    const withManual = old.replace('<p class="a4-signature">', '<p><br></p><p class="a4-signature">')
    expect(editorHtmlToPlainText(restoreLegacySpacers(withManual,ref,false))).toBe('说明\n更新。\n\n\n值班室')
  })
})

describe('模板设置校验', () => {
  it('拒绝类型错误、无效数值及超出纸张的页边距，缺字段继续继承默认值', () => {
    for (const bad of [{ specialOptions: {signatureName: 123} }, { body: {fontSize: 0} }, { header: {mode:'unknown'} }, {margins:{left:12,right:10}}]) {
      expect(() => normalizeDocumentConfig(bad as never)).toThrow()
    }
    expect(normalizeDocumentConfig({ specialOptions: { signatureName: '值班室' } }).specialOptions.signatureDate).toBe('')
  })
})
