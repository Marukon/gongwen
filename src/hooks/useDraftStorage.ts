import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DRAFT_KEY, draftRevision, loadDraft, saveDraft, type DocumentDraft } from '../utils/documentDraft'

const COPY = DRAFT_KEY + ':copy:'
const POINTER = DRAFT_KEY + ':open'
const blank = (): DocumentDraft => ({ text: '', editedHtml: null })
function revision(storage: Storage, key: string) {
  const raw = storage.getItem(key)
  if (!raw) return null
  try { return JSON.parse(raw)?.revision ?? raw } catch { return raw }
}
function copies() {
  try { return Object.keys(localStorage).filter(k => k.startsWith(COPY)).sort().reverse() } catch { return [] }
}
function initial(prepare: (draft: DocumentDraft, legacy: boolean) => DocumentDraft) {
  try {
    let pointer: string | null = null
    try { pointer = sessionStorage.getItem(POINTER) } catch { /* the shared draft is still available */ }
    const key = pointer?.startsWith(COPY) && localStorage.getItem(pointer) ? pointer : DRAFT_KEY
    const raw = localStorage.getItem(key)
    let legacy = true
    try { legacy = !raw || JSON.parse(raw)?.syncVersion !== 1 } catch { /* legacy fallback */ }
    return { key, version: revision(localStorage, key), draft: prepare(loadDraft(localStorage, key), legacy) }
  } catch { return { key: DRAFT_KEY, version: null, draft: blank() } }
}

export function useDraftStorage(prepare: (draft: DocumentDraft, legacy: boolean) => DocumentDraft) {
  const [entry] = useState(() => initial(prepare))
  const [draft, setDraft] = useState(entry.draft)
  const [active, setActive] = useState(entry.key)
  const [alternatives, setAlternatives] = useState(copies)
  const [failed, setFailed] = useState(false)
  const cursor = useRef({ key: entry.key, version: entry.version })
  const lastSaved = useRef(entry.draft)
  const current = useRef(draft)
  useLayoutEffect(() => { current.current = draft }, [draft])
  const refresh = useCallback(() => setAlternatives(copies()), [])
  const selectDraftKey = useCallback((key: string) => {
    setActive(key)
    try { sessionStorage.setItem(POINTER, key) } catch { /* copies remain accessible through the list */ }
    refresh()
  }, [refresh])

  const persist = useCallback((next: DocumentDraft) => {
    if (lastSaved.current === next) return
    try {
      const c = cursor.current
      const conflict = revision(localStorage, c.key) !== c.version
      const key = conflict ? COPY + Date.now() + ':' + draftRevision() : c.key
      const version = draftRevision()
      saveDraft(localStorage, next, key, version)
      cursor.current = { key, version }
      lastSaved.current = next
      setFailed(false)
      if (conflict) selectDraftKey(key)
    } catch { setFailed(true) }
  }, [selectDraftKey])

  useEffect(() => {
    if (lastSaved.current === draft) return
    let cancelled = false
    const save = () => { if (!cancelled && current.current === draft) persist(draft) }
    // Serialize the compare-and-write across editing tabs on HTTPS and localhost.
    if (navigator.locks) void navigator.locks.request(DRAFT_KEY, save).catch(() => setFailed(true))
    else save()
    return () => { cancelled = true }
  }, [draft, persist])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (!e.key || e.key.startsWith(COPY)) refresh() }
    const onExit = () => {
      // If the browser closes before a queued save gets the lock, preserve a separate recovery copy.
      if (lastSaved.current === current.current) return
      try {
        const key = COPY + Date.now() + ':' + draftRevision()
        saveDraft(localStorage, current.current, key)
        sessionStorage.setItem(POINTER, key)
      } catch { /* storage warning remains visible while editing */ }
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('pagehide', onExit)
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('pagehide', onExit) }
  }, [refresh])

  const open = (key: string) => {
    try {
      if (lastSaved.current !== current.current) persist(current.current)
      if (lastSaved.current !== current.current) return
      if (!localStorage.getItem(key) && key !== DRAFT_KEY) { refresh(); return }
      const raw = localStorage.getItem(key)
      const next = prepare(loadDraft(localStorage, key), !raw || JSON.parse(raw).syncVersion !== 1)
      lastSaved.current = next
      cursor.current = { key, version: revision(localStorage, key) }
      selectDraftKey(key); setDraft(next)
    } catch { setFailed(true) }
  }
  return { draft, setDraft, current, failed, active, alternatives, open }
}
