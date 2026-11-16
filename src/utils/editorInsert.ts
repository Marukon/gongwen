const PARAGRAPH = 'p,div,h1,h2,h3,h4,h5,h6'

function topLevelParagraph(editor: HTMLElement, node: Node): HTMLElement | undefined {
  let current: Node | null = node
  while (current && current.parentNode !== editor) current = current.parentNode
  return current instanceof HTMLElement && current.matches(PARAGRAPH) ? current : undefined
}

function keepFragment(fragment: DocumentFragment): boolean {
  return !!fragment.textContent?.length || fragment.querySelectorAll('br').length > 1
}

export function insertLayoutParagraphs(editor: HTMLElement, content: HTMLElement): boolean {
  const children = Array.from(content.children)
  const hasLayout = children.length > 1 || children.some((child) => child instanceof HTMLElement &&
    (child.style.textAlign || child.hasAttribute('align') || child.querySelector(PARAGRAPH)))
  if (!hasLayout) return false

  const selection = window.getSelection()
  if (!selection?.rangeCount) return false
  const range = selection.getRangeAt(0)
  if (!editor.contains(range.commonAncestorContainer)) return false
  const start = topLevelParagraph(editor, range.startContainer)
  const end = topLevelParagraph(editor, range.endContainer)
  if (!start || !end) return false

  // 把带独立段落样式的剪贴内容插在段落级别，避免浏览器把首段并入光标所在段。
  const before = document.createRange()
  before.selectNodeContents(start)
  before.setEnd(range.startContainer, range.startOffset)
  const after = document.createRange()
  after.selectNodeContents(end)
  after.setStart(range.endContainer, range.endOffset)
  const left = before.cloneContents()
  const right = after.cloneContents()
  const fragment = document.createDocumentFragment()
  const appendPartial = (base: HTMLElement, part: DocumentFragment) => {
    if (!keepFragment(part)) return
    const block = base.cloneNode(false) as HTMLElement
    block.append(part)
    fragment.append(block)
  }
  appendPartial(start, left)
  const lastPasted = content.lastElementChild
  fragment.append(...content.childNodes)
  appendPartial(end, right)
  const next = end.nextSibling
  let old: Node | null = start
  while (old && old !== next) {
    const following: Node | null = old.nextSibling
    editor.removeChild(old)
    old = following
  }
  editor.insertBefore(fragment, next)
  if (lastPasted) {
    const caret = document.createRange()
    caret.selectNodeContents(lastPasted)
    caret.collapse(false)
    selection.removeAllRanges()
    selection.addRange(caret)
  }
  return true
}
