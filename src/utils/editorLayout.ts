import type { AttachmentNode, RichTextRun } from '../types/ast'

export const MAX_OFFSET_CHARS = 8

export function readOffset(raw: string | undefined): number | undefined {
  const offset = Number(raw)
  return Number.isInteger(offset) && offset !== 0 && Math.abs(offset) <= MAX_OFFSET_CHARS ? offset : undefined
}

export function offsetTransform(chars: number | undefined): string | undefined {
  return chars ? `translateX(calc(var(--body-size, 16pt) * ${chars}))` : undefined
}

export function attachmentClass(kind: NonNullable<AttachmentNode['layoutLine']>): string {
  return {
    single: 'a4-attachment a4-attachment--single',
    first: 'a4-attachment a4-attachment--multi-first',
    item: 'a4-attachment-item a4-attachment-item--multi',
  }[kind]
}

export function hasRichStyleOverrides(runs?: RichTextRun[]): boolean {
  if (runs?.some((run) => run.bold !== undefined || run.italic !== undefined || run.underline !== undefined ||
    run.fontFamily || run.fontSize || run.color)) return true
  return !!runs?.length && (/^\s/.test(runs[0].text) || /\s$/.test(runs[runs.length - 1].text))
}
