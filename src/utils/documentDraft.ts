export const DRAFT_KEY = 'docx-editor-draft'
const LEGACY_TEXT = 'docx-editor-source-text'
const LEGACY_HTML = 'docx-editor-formatted-html'

export interface DocumentDraft {
  text: string
  editedHtml: string | null
}

export function loadDraft(storage: Storage, key = DRAFT_KEY): DocumentDraft {
  const saved = storage.getItem(key)
  if (saved !== null) {
    try {
      const draft: unknown = JSON.parse(saved)
      if (draft && typeof draft === 'object' && 'text' in draft && 'editedHtml' in draft &&
        typeof draft.text === 'string' && (draft.editedHtml === null || typeof draft.editedHtml === 'string')) {
        return { text: draft.text, editedHtml: draft.editedHtml }
      }
    } catch {
      // A damaged new record must not prevent recovery of a legacy draft.
    }
  }
  if (key !== DRAFT_KEY) return { text: '', editedHtml: null }
  return {
    text: storage.getItem(LEGACY_TEXT) ?? '',
    editedHtml: storage.getItem(LEGACY_HTML) || null,
  }
}

export function draftRevision(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(36)).join('-')
}

export function saveDraft(storage: Storage, draft: DocumentDraft, key = DRAFT_KEY, revision = draftRevision()) {
  storage.setItem(key, JSON.stringify({ ...draft, revision, syncVersion: 1 }))
  if (key !== DRAFT_KEY) return
  // Remove old values only after the replacement was written successfully.
  if (storage.getItem(LEGACY_TEXT) !== null) storage.removeItem(LEGACY_TEXT)
  if (storage.getItem(LEGACY_HTML) !== null) storage.removeItem(LEGACY_HTML)
}
