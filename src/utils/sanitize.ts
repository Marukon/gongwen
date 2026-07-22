import { NodeType } from '../types/ast'
import { detectNodeType } from '../parser/matchers'

/**
 * 文本修复工具
 *
 * 1. 将中文语境下误用的英文标点替换为中文标点。
 * 2. 清理 AI 生成文本中常见的多余空格、制表符和连续空行。
 */

const CJK_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
const CJK_OR_FULLWIDTH_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/
const DIGIT_OR_CJK_NUMERAL = /[0-9一二三四五六七八九十百千万零]/

/** 枚举子项：中文数字 + “是”，如「一是」「十二是」（不应被合并进上一段） */
const SUB_ITEM_RE = /^[一二三四五六七八九十]+是/

/** 日期行：全角或半角括号包裹的 YYYY年M月D日，或裸日期 */
const DATE_LINE_RE = /^(?:（|\()?\d{4}年\d{1,2}月\d{1,2}日(?:）|\))?$/

const PUNCTUATION_REPLACEMENTS = new Map<string, string>([
  [',', '，'],
  [':', '：'],
  [';', '；'],
  ['?', '？'],
  ['!', '！'],
  ['(', '（'],
  [')', '）'],
])

export interface SanitizeResult {
  text: string
  count: number
}

export interface AutoFixResult extends SanitizeResult {
  punctuationCount: number
  whitespaceCount: number
  lineBreakCount: number
}

export interface TextFixOptions {
  convertEnglishPunctuation: boolean
  removeRedundantSpaces: boolean
  removeMeaninglessLineBreaks: boolean
}

const DEFAULT_TEXT_FIX_OPTIONS: TextFixOptions = {
  convertEnglishPunctuation: true,
  removeRedundantSpaces: true,
  removeMeaninglessLineBreaks: true,
}

function charAt(text: string, index: number): string {
  return index >= 0 && index < text.length ? text[index] : ''
}

function isCjkChar(char: string): boolean {
  return CJK_CHAR.test(char)
}

function isCjkOrFullwidthChar(char: string): boolean {
  return CJK_OR_FULLWIDTH_CHAR.test(char)
}

function isDigitOrChineseNumeral(char: string): boolean {
  return DIGIT_OR_CJK_NUMERAL.test(char)
}

function replaceWhenNeeded(
  text: string,
  shouldReplace: (index: number, source: string) => boolean,
): SanitizeResult {
  let count = 0
  const chars = Array.from(text)

  for (let index = 0; index < chars.length; index++) {
    const current = chars[index]
    const replacement = PUNCTUATION_REPLACEMENTS.get(current)
    if (!replacement || !shouldReplace(index, text)) continue

    chars[index] = replacement
    count++
  }

  return { text: chars.join(''), count }
}

/**
 * 处理双引号（交替 “ ”）
 */
function replaceQuotes(text: string): SanitizeResult {
  let count = 0
  let open = true
  const chars = Array.from(text)

  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== '"') continue

    chars[i] = open ? '“' : '”'
    open = !open
    count++
  }

  return { text: chars.join(''), count }
}

export function replaceEnglishPunctuation(text: string): SanitizeResult {
  let result = text
  let count = 0

  // 普通标点
  const common = replaceWhenNeeded(result, (index, source) => {
    const current = charAt(source, index)
    const previous = charAt(source, index - 1)
    const next = charAt(source, index + 1)

    if (current === '(' || current === ')') {
      return (
        isDigitOrChineseNumeral(previous) ||
        isDigitOrChineseNumeral(next) ||
        isCjkChar(previous) ||
        isCjkChar(next)
      )
    }

    return isCjkOrFullwidthChar(previous) || isCjkOrFullwidthChar(next)
  })

  result = common.text
  count += common.count

  // 句号
  result = result.replace(/\./g, (match, offset, source) => {
    const previous = charAt(source, offset - 1)
    const next = charAt(source, offset + 1)
    const shouldConvert = isCjkChar(previous) && !/[0-9A-Za-z]/.test(next)

    if (!shouldConvert) return match

    count++
    return '。'
  })

  // 双引号（最后处理，避免干扰判断）
  const quoteResult = replaceQuotes(result)
  result = quoteResult.text
  count += quoteResult.count

  return { text: result, count }
}

function applyRegexReplacements(
  text: string,
  replacements: Array<[RegExp, string]>,
): SanitizeResult {
  let result = text
  let count = 0

  for (const [pattern, replacement] of replacements) {
    const matches = Array.from(result.matchAll(pattern))
    count += matches.length
    result = result.replace(pattern, replacement)
  }

  return { text: result, count }
}

export function removeRedundantSpaces(text: string): SanitizeResult {
  const normalized = applyRegexReplacements(text, [
    [/\u00a0/g, ' '],
    [/\u3000/g, ' '],
    [/\t+/g, ' '],
    [/([（《【“])[ \t]+/g, '$1'],
    [/[ \t]+([）】》”，。；：！？、])/g, '$1'],
    [/([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])[ \t]+([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])/g, '$1$2'],
    [/([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])[ \t]+([（《【“])/g, '$1$2'],
    [/([）】》”])[ \t]+([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])/g, '$1$2'],
    [/([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])[ \t]+([，。；：！？、])/g, '$1$2'],
    [/([，。；：！？、])[ \t]+([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])/g, '$1$2'],
  ])

  let count = normalized.count
  let result = normalized.text

  result = result
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (trimmed !== line) count++
      return trimmed
    })
    .join('\n')

  result = result.replace(/\n{3,}/g, () => {
    count++
    return '\n\n'
  })

  return { text: result, count }
}

export function removeMeaninglessLineBreaks(text: string): SanitizeResult {
  const lines = text.split(/\r?\n/)
  const resultLines: string[] = []
  let count = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (resultLines.length === 0) {
      resultLines.push(line)
      continue
    }

    const prevLine = resultLines[resultLines.length - 1]
    const prevTrimmed = prevLine.trim()
    const currentTrimmed = line.trim()

    if (prevTrimmed.length === 0 || currentTrimmed.length === 0) {
      resultLines.push(line)
      continue
    }

    let nonEmptyCount = 0
    for (const l of resultLines) {
      if (l.trim().length > 0) {
        nonEmptyCount++
      }
    }
    const isPrevTitleLine = nonEmptyCount === 1 && !/[：:]/.test(prevTrimmed)

    if (isPrevTitleLine) {
      resultLines.push(line)
      continue
    }

    const prevType = detectNodeType(prevTrimmed)
    const currentType = detectNodeType(currentTrimmed)

    const isPrevHeading = prevType !== NodeType.PARAGRAPH
    const isCurrentHeading = currentType !== NodeType.PARAGRAPH

    const LIST_MARKER_RE = /^([①②③④⑤⑥⑦⑧⑨⑩]|\s*[-*•+])/
    const isCurrentListMarker = LIST_MARKER_RE.test(currentTrimmed)
    const hasIndent = /^(?:\s{2,}|\u3000+)/.test(line)
    const endsWithColon = /[：:]$/.test(prevTrimmed)
    const isPrevSentenceComplete = /[。！？]$/.test(prevTrimmed)
    // 当前行以冒号结尾（如主送机关、通知如下等），应作为独立段落，不向前合并
    const isCurrentColonEnding = /[：:]$/.test(currentTrimmed)
    // 日期行（如（2026年7月24日））应独立，避免与姓名/机关署名合并
    const isCurrentDateLine = DATE_LINE_RE.test(currentTrimmed)
    const isPrevDateLine = DATE_LINE_RE.test(prevTrimmed)
    // 「一是/二是/三是…」等中文数字+“是”开头的枚举子项，应作为独立段落，
    // 不向前合并（否则会因上一段不以冒号结尾而被吞并，导致仅首句被加粗）。
    const isCurrentSubItem = SUB_ITEM_RE.test(currentTrimmed)

    if (
      isPrevSentenceComplete ||
      isPrevHeading ||
      isCurrentHeading ||
      isCurrentListMarker ||
      hasIndent ||
      endsWithColon ||
      isCurrentColonEnding ||
      isCurrentDateLine ||
      isPrevDateLine ||
      isCurrentSubItem
    ) {
      resultLines.push(line)
    } else {
      const lastChar = prevLine[prevLine.length - 1]
      const firstChar = line[0]
      const needsSpace = /[A-Za-z0-9]/.test(lastChar) && /[A-Za-z0-9]/.test(firstChar)
      resultLines[resultLines.length - 1] = prevLine + (needsSpace ? ' ' : '') + currentTrimmed
      count++
    }
  }

  return { text: resultLines.join('\n'), count }
}

export function autoFixDocumentText(
  text: string,
  options: TextFixOptions = DEFAULT_TEXT_FIX_OPTIONS,
): AutoFixResult {
  const punctuation = options.convertEnglishPunctuation
    ? replaceEnglishPunctuation(text)
    : { text, count: 0 }

  const lineBreaks = options.removeMeaninglessLineBreaks
    ? removeMeaninglessLineBreaks(punctuation.text)
    : { text: punctuation.text, count: 0 }

  const whitespace = options.removeRedundantSpaces
    ? removeRedundantSpaces(lineBreaks.text)
    : { text: lineBreaks.text, count: 0 }

  return {
    text: whitespace.text,
    punctuationCount: punctuation.count,
    whitespaceCount: whitespace.count,
    lineBreakCount: lineBreaks.count,
    count: punctuation.count + whitespace.count + lineBreaks.count,
  }
}

export function sanitizeText(
  text: string,
  options: TextFixOptions = DEFAULT_TEXT_FIX_OPTIONS,
): SanitizeResult {
  const result = autoFixDocumentText(text, options)
  return { text: result.text, count: result.count }
}
