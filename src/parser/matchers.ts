import { NodeType } from '../types/ast'
import type { AttachmentItem } from '../types/ast'
import { normalizeDocumentDate } from '../utils/documentDates'
import { detectHeading } from './headings'

// 附件说明：以"附件"开头 + 全角/半角冒号
export const ATTACHMENT_RE = /^附件[：:]/

/**
 * 从单行文本中提取连续的附件项
 *
 * @param text 文本内容
 * @param startIndex 期望的起始序号
 * @returns 提取的附件项 + 剩余文本
 */
export function extractAttachmentItemsFromLine(
  text: string,
  startIndex: number
): { items: AttachmentItem[]; remaining: string } {
  const items: AttachmentItem[] = []
  let remaining = text
  let expectedIndex = startIndex

  while (remaining.length > 0) {
    // 尝试匹配期望序号的附件项
    const pattern = new RegExp(`^${expectedIndex}[.．．.]\\s*`)
    const match = remaining.match(pattern)

    if (!match) {
      break
    }

    // 移除序号和点号
    remaining = remaining.slice(match[0].length)

    // 查找下一个序号的位置，或到文本末尾
    const nextIndexPattern = /(?=\d+[.．．.])/
    const nextMatch = remaining.match(nextIndexPattern)

    let name: string
    if (nextMatch && nextMatch.index !== undefined) {
      name = remaining.slice(0, nextMatch.index).trim()
      remaining = remaining.slice(nextMatch.index)
    } else {
      name = remaining.trim()
      remaining = ''
    }

    items.push({ index: expectedIndex, name })
    expectedIndex++
  }

  return { items, remaining }
}

/**
 * 检测单行文本的节点类型（纯函数）
 * 不含标题判断逻辑，标题由 parser 层根据位置决定
 *
 * 优先级：ATTACHMENT → DATE → HEADING_1~4 → PARAGRAPH
 * 附件必须在标题之前匹配，避免"附件：1.xxx"误命中 HEADING_3
 */
export function detectNodeType(line: string): NodeType {
  const trimmed = line.trim()

  if (ATTACHMENT_RE.test(trimmed)) return NodeType.ATTACHMENT
  if (normalizeDocumentDate(trimmed)) return NodeType.DATE
  return detectHeading(trimmed) ?? NodeType.PARAGRAPH
}
