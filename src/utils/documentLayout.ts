import type { ParagraphAlignment } from '../types/ast'
import { CHARS_PER_LINE, cmToTwip, ptToTwip, type DocumentConfig } from '../types/documentConfig'

// Twenty twips are one point. Use the same grid in CSS and in the Word document.
export function getCharacterSpacingTwips(config: DocumentConfig): number {
  const available = 11906 - cmToTwip(config.margins.left) - cmToTwip(config.margins.right)
  return Math.floor((available - ptToTwip(config.body.fontSize) * CHARS_PER_LINE) / (CHARS_PER_LINE - 1))
}

export function getGridCharacterWidthTwips(config: DocumentConfig): number {
  return ptToTwip(config.body.fontSize) + getCharacterSpacingTwips(config)
}

function estimateWidthHundredths(text: string, asciiWidth: number): number {
  let width = 0
  for (const char of text.trim()) {
    width += /[\u3400-\u9fff\u3000-\u303f\uff01-\uff5e]/.test(char) ? 100 : asciiWidth
  }
  return width
}

export function getSignatureIndentChars({
  hasStamp, name, date, alignment, noIndent,
}: {
  hasStamp: boolean
  name?: string
  date?: string
  alignment?: ParagraphAlignment
  noIndent?: boolean
}): number {
  if (noIndent || (alignment && alignment !== 'justify')) return 0
  const right = hasStamp ? 4 : 2
  return name?.trim() && date?.trim()
    ? Math.max(0, right + (estimateWidthHundredths(date, 69) - estimateWidthHundredths(name, 69)) / 200)
    : right
}

export function getSupplementalSignatureIndents(name: string, date: string) {
  const nameWidth = estimateWidthHundredths(name, 50)
  const dateWidth = estimateWidthHundredths(date, 50)
  const dateIndent = dateWidth > nameWidth + 200 ? 5 : 4
  return { nameIndent: Math.max(0, dateIndent + (dateWidth - nameWidth) / 200), dateIndent }
}

export function getParagraphOffsetTwips(offsetChars: number | undefined, bodyFontSize: number): number {
  return Math.round(ptToTwip((offsetChars ?? 0) * bodyFontSize))
}

export const MAX_PARAGRAPH_INDENT_TWIPS = 11906

export function readParagraphIndent(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined
  const value = Number(raw)
  return Number.isInteger(value) && Math.abs(value) <= MAX_PARAGRAPH_INDENT_TWIPS ? value : undefined
}

export function paragraphIndents(twips: number) {
  return { left: Math.max(0, twips), right: Math.max(0, -twips) }
}

export function paragraphIndentCss(twips: number | undefined) {
  if (twips === undefined) return undefined
  const { left, right } = paragraphIndents(twips)
  return { paddingLeft: `${left / 20}pt`, paddingRight: `${right / 20}pt` }
}
