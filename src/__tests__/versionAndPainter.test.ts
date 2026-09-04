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

describe('Version Sequence Numbering', () => {
  it('generates version string in vYYYY.MM.DD-N format', () => {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    const baseDate = `v${y}.${m}.${d}`

    const seq1 = 1
    const v1 = `${baseDate}-${seq1}`
    expect(v1).toMatch(/^v\d{4}\.\d{2}\.\d{2}-1$/)

    const seq2 = seq1 + 1
    const v2 = `${baseDate}-${seq2}`
    expect(v2).toMatch(/^v\d{4}\.\d{2}\.\d{2}-2$/)
  })
})
