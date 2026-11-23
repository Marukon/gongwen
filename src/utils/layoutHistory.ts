interface LayoutSnapshot {
  html: string
  sourceText?: string
  block?: number
}

const HISTORY_LIMIT = 80
const TYPING_GAP_MS = 650

export class LayoutHistory {
  present: LayoutSnapshot | undefined
  private past: LayoutSnapshot[] = []
  private future: LayoutSnapshot[] = []
  private typing?: { kind: string; time: number; block?: number }

  get canUndo() { return this.past.length > 0 }
  get canRedo() { return this.future.length > 0 }

  reset(snapshot: LayoutSnapshot) {
    this.present = snapshot
    this.past = []
    this.future = []
    this.breakTyping()
  }

  breakTyping() {
    this.typing = undefined
  }

  record(snapshot: LayoutSnapshot, kind?: string, time = Date.now()) {
    if (!this.present) {
      this.reset(snapshot)
      return
    }
    if (snapshot.html === this.present.html) return
    const recent = !!kind && this.typing?.kind === kind &&
      this.typing.block === snapshot.block && time - this.typing.time < TYPING_GAP_MS
    if (!recent) {
      this.past.push(this.present)
      if (this.past.length > HISTORY_LIMIT) this.past.shift()
    }
    this.present = snapshot
    this.future = []
    this.typing = kind ? { kind, time, block: snapshot.block } : undefined
  }

  step(direction: 'undo' | 'redo'): LayoutSnapshot | undefined {
    const from = direction === 'undo' ? this.past : this.future
    const to = direction === 'undo' ? this.future : this.past
    const target = from.pop()
    if (!target || !this.present) return undefined
    to.push(this.present)
    this.present = target
    this.breakTyping()
    return target
  }
}
