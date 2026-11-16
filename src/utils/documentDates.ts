import { NodeType, type GongwenAST } from '../types/ast'
import type { SpecialOptionsConfig } from '../types/documentConfig'

// 公文日期是日历值，不经过本地时区转换。
export function normalizeDocumentDate(text: string): string | null {
  const match = /^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日$/.exec(text.trim())
  if (!match) return null
  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const monthLengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (!year || month < 1 || month > 12 || day < 1 || day > monthLengths[month - 1]) return null
  return `${yearText}年${month}月${day}日`
}

export function readTitleDate(text: string): string | null {
  const trimmed = text.trim()
  const wrapped = /^(?:（(.*)）|\((.*)\))$/.exec(trimmed)
  return normalizeDocumentDate(wrapped ? (wrapped[1] ?? wrapped[2]) : trimmed)
}

export function ensureTitleDateParentheses(text: string): string {
  const date = readTitleDate(text)
  return date ? `（${date}）` : text
}

export function getTitleMetadataIndices({ title, body }: GongwenAST, enabled: boolean) {
  const none = { name: -1, date: -1 }
  if (!enabled || !title) return none
  const name = body.findIndex((node) => node.content.trim() !== '')
  if (name < 0 || (body[name].type !== NodeType.PARAGRAPH && body[name].type !== NodeType.SIGNATURE)) return none
  const nameText = body[name].content.trim()
  if (nameText.length > 24 || /[。！？；：，、!?;:,]/.test(nameText)) return none
  const date = body.findIndex((node, index) => index > name && node.content.trim() !== '')
  if (date < 0 || !readTitleDate(body[date].content)) return none
  return { name, date }
}

/** 文末识别到成文日期时，设置中的日期仅作为备用。 */
function hasClosingDate({ title, body }: GongwenAST, enabled: boolean): boolean {
  const { date } = getTitleMetadataIndices({ title, body }, enabled)
  for (let index = body.length - 1; index >= 0; index--) {
    const node = body[index]
    if (node.content.trim() && node.type !== NodeType.ATTACHMENT) {
      return index !== date && node.type === NodeType.DATE
    }
  }
  return false
}

export function getSupplementalSignature(ast: GongwenAST, options: SpecialOptionsConfig) {
  if (hasClosingDate(ast, options.hasTitleNameDate)) return { name: '', date: '' }
  return {
    name: options.signatureName.trim(),
    date: normalizeDocumentDate(options.signatureDate) ?? options.signatureDate.trim(),
  }
}
