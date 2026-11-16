const DRAFT_KEY = 'docx-editor-draft'
const LEGACY_TEXT = 'docx-editor-source-text'
const LEGACY_HTML = 'docx-editor-formatted-html'

export interface DocumentDraft {
  text: string
  editedHtml: string | null
}

export function loadDraft(storage: Storage): DocumentDraft {
  const saved = storage.getItem(DRAFT_KEY)
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
  return {
    text: storage.getItem(LEGACY_TEXT) ?? '',
    editedHtml: storage.getItem(LEGACY_HTML) || null,
  }
}

export function saveDraft(storage: Storage, draft: DocumentDraft) {
  storage.setItem(DRAFT_KEY, JSON.stringify(draft))
  // Remove old values only after the replacement was written successfully.
  if (storage.getItem(LEGACY_TEXT) !== null) storage.removeItem(LEGACY_TEXT)
  if (storage.getItem(LEGACY_HTML) !== null) storage.removeItem(LEGACY_HTML)
}
