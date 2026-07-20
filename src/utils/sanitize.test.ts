import { describe, expect, it } from 'vitest'
import {
  autoFixDocumentText,
  removeRedundantSpaces,
  replaceEnglishPunctuation,
  removeMeaninglessLineBreaks,
  sanitizeText,
} from './sanitize'

describe('replaceEnglishPunctuation', () => {
  it('将中文语境中的英文标点替换为中文标点', () => {
    const result = replaceEnglishPunctuation('各单位: 请认真贯彻落实, 确保执行到位!')

    expect(result.text).toBe('各单位： 请认真贯彻落实， 确保执行到位！')
    expect(result.count).toBe(3)
  })

  it('保留英文语句中的英文标点', () => {
    const result = replaceEnglishPunctuation('Hello, world! Version 2.0 is ready.')

    expect(result.text).toBe('Hello, world! Version 2.0 is ready.')
    expect(result.count).toBe(0)
  })

  it('将中文标题中的半角括号替换为全角括号', () => {
    const result = replaceEnglishPunctuation('(一) 工作要求')

    expect(result.text).toBe('（一） 工作要求')
    expect(result.count).toBe(2)
  })
})

describe('removeRedundantSpaces', () => {
  it('清理中文之间和标点附近的多余空格', () => {
    const result = removeRedundantSpaces('各 单位 ： 请 认真 落实 。')

    expect(result.text).toBe('各单位：请认真落实。')
    expect(result.count).toBeGreaterThan(0)
  })

  it('保留英文短语内部的正常空格', () => {
    const result = removeRedundantSpaces('请使用 OpenAI API 进行测试')

    expect(result.text).toBe('请使用 OpenAI API 进行测试')
  })

  it('清理行首尾空格和连续空行', () => {
    const result = removeRedundantSpaces('  标题  \n\n\n  正文  ')

    expect(result.text).toBe('标题\n\n正文')
    expect(result.count).toBeGreaterThanOrEqual(3)
  })
})

describe('removeMeaninglessLineBreaks', () => {
  it('合并无意义的回车，保留标题、一级标题、空行、缩进等', () => {
    const text = `公文拟办工作规范（试行）

为进一步提高省政府办公厅公文拟办工作质效，更好地
发挥参谋助手作用，不断提升“四个服务”水平，结合工作实际，制定本规范。
一、重要意义
公文拟办是省政府办公厅一项关键性、基础性工作，是发挥参谋助手作用、辅
助领导科学决策的重要方式。高质量的公文拟办意见，能够让领导快速了解公文主旨，及时作出准确批示，加快公文办理效率，促进工作有效落实。`
    
    const expected = `公文拟办工作规范（试行）

为进一步提高省政府办公厅公文拟办工作质效，更好地发挥参谋助手作用，不断提升“四个服务”水平，结合工作实际，制定本规范。
一、重要意义
公文拟办是省政府办公厅一项关键性、基础性工作，是发挥参谋助手作用、辅助领导科学决策的重要方式。高质量的公文拟办意见，能够让领导快速了解公文主旨，及时作出准确批示，加快公文办理效率，促进工作有效落实。`

    const result = removeMeaninglessLineBreaks(text)
    expect(result.text).toBe(expected)
    expect(result.count).toBe(2)
  })

  it('不合带有缩进的行或以冒号结尾的行', () => {
    const text = `主送机关：
  第一行缩进
  第二行缩进`
    const result = removeMeaninglessLineBreaks(text)
    expect(result.text).toBe(text)
    expect(result.count).toBe(0)
  })

  it('不合并「一是/二是/三是」等中文数字枚举子项', () => {
    const text = `二、思路举措：全面提升质效
一是强化政治引领，当好排头兵。
二是聚焦中心大局，当好信息库。
三是严守纪律规矩，当好践行者。`
    const result = removeMeaninglessLineBreaks(text)
    const lines = result.text.split('\n')
    expect(lines).toContain('一是强化政治引领，当好排头兵。')
    expect(lines).toContain('二是聚焦中心大局，当好信息库。')
    expect(lines).toContain('三是严守纪律规矩，当好践行者。')
    // 三个子项各自独立成行，未被合并
    expect(result.count).toBe(0)
  })
})

describe('autoFixDocumentText', () => {
  it('组合修复英文标点、回车和多余空格', () => {
    const result = autoFixDocumentText('各 单位: 请\n 认真 贯彻 落实, 确保成效!')

    expect(result.text).toBe('各单位：请认真贯彻落实，确保成效！')
    expect(result.punctuationCount).toBe(3)
    expect(result.lineBreakCount).toBe(1)
    expect(result.whitespaceCount).toBeGreaterThan(0)
    expect(result.count).toBe(result.punctuationCount + result.whitespaceCount + result.lineBreakCount)
  })

  it('支持按配置关闭部分修复能力', () => {
    const result = autoFixDocumentText('各 单位: 请\n 认真 落实!', {
      convertEnglishPunctuation: false,
      removeRedundantSpaces: true,
      removeMeaninglessLineBreaks: false,
    })

    expect(result.text).toBe('各单位: 请\n认真落实!')
    expect(result.punctuationCount).toBe(0)
    expect(result.lineBreakCount).toBe(0)
    expect(result.whitespaceCount).toBeGreaterThan(0)
  })
})

describe('sanitizeText', () => {
  it('保持与组合修复结果一致', () => {
    expect(sanitizeText('附件: 1. 实施 方案').text).toBe('附件： 1. 实施方案')
  })
})
