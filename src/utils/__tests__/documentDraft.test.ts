import { describe, expect, it, vi } from 'vitest'
import { loadDraft, saveDraft } from '../documentDraft'

function makeStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))
  return {
    get length() { return values.size },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
    clear: () => values.clear(),
  }
}

describe('本地草稿', () => {
  const legacy = {
    'docx-editor-source-text': '原文',
    'docx-editor-formatted-html': '<p><strong>手工排版</strong></p>',
  }

  it('迁移旧草稿时保留原文与手工排版，清空后不会恢复旧内容', () => {
    const storage = makeStorage(legacy)
    const draft = loadDraft(storage)
    expect(draft).toEqual({ text: '原文', editedHtml: '<p><strong>手工排版</strong></p>' })
    saveDraft(storage, draft)
    expect(loadDraft(storage)).toEqual(draft)
    expect(storage.length).toBe(1)
    saveDraft(storage, { text: '', editedHtml: null })
    expect(loadDraft(storage)).toEqual({ text: '', editedHtml: null })
  })

  it('写入失败时保留旧草稿；损坏记录可回退到旧草稿', () => {
    const storage = makeStorage({ ...legacy, 'docx-editor-draft': '{' })
    const draft = loadDraft(storage)
    vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('没有存储空间') })
    expect(() => saveDraft(storage, { text: '新草稿', editedHtml: null })).toThrow('没有存储空间')
    expect(loadDraft(storage)).toEqual(draft)
  })
})
