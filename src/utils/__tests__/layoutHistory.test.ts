import { describe, expect, it } from 'vitest'
import { LayoutHistory } from '../layoutHistory'

describe('LayoutHistory', () => {
  it('撤销和还原保存的版面；撤销后继续编辑会清除还原', () => {
    const history = new LayoutHistory()
    history.reset({ html: '源稿' })
    history.record({ html: '移动落款', block: 5 })
    history.record({ html: '加粗落款', block: 5 })
    expect(history.step('undo')).toEqual({ html: '移动落款', block: 5 })
    expect(history.step('redo')).toEqual({ html: '加粗落款', block: 5 })
    expect(history.step('undo')?.html).toBe('移动落款')
    history.record({ html: '居中落款' })
    expect(history.canRedo).toBe(false)
    expect(history.step('undo')?.html).toBe('移动落款')
    expect(history.step('undo')?.html).toBe('源稿')
    expect(history.canUndo).toBe(false)
  })

  it('将连续输入合为一步，但点击或切换光标会结束合并', () => {
    const history = new LayoutHistory()
    history.reset({ html: '底稿' })
    history.record({ html: '底稿甲', block: 1 }, 'insertText', 100)
    history.record({ html: '底稿甲乙', block: 1 }, 'insertText', 200)
    history.breakTyping()
    history.record({ html: '底稿甲乙丙', block: 1 }, 'insertText', 300)
    expect(history.step('undo')?.html).toBe('底稿甲乙')
    expect(history.step('undo')?.html).toBe('底稿')
  })
})
