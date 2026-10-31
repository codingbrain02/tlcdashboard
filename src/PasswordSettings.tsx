import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './supabase'

export default function PasswordSettings({ onChanged, onClose }: { onChanged: () => void; onClose: () => void }) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const currentField = useRef<HTMLInputElement>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    element?.showModal()
    currentField.current?.focus()
    document.body.style.overflow = 'hidden'
    return () => {
      element?.close()
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])
  const field = 'mt-2 min-h-12 w-full rounded-xl border border-line bg-soft px-4 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || busy) return
    if (next !== confirm) { setError('New passwords do not match.'); return }
    if (current === next) { setError('Choose a different password.'); return }
    setBusy(true); setError('')
    try {
      const result = await supabase.functions.invoke('admin-api', { body: { action: 'change-password', currentPassword: current, newPassword: next } })
      if (result.error) {
        let message = 'Could not change your password. Please try again.'
        try { message = (await result.error.context?.json())?.message || message } catch { /* generic fallback */ }
        setError(message); return
      }
      setCurrent(''); setNext(''); setConfirm('')
      onClose()
      onChanged()
    } catch { setError('Password service is temporarily unavailable.') }
    finally { setBusy(false) }
  }
  return createPortal(<dialog ref={dialog} aria-labelledby={id + '-title'} aria-describedby={id + '-description'} onCancel={event => { event.preventDefault(); if (!busy) onClose() }} onClick={event => {
    if (busy || event.target !== event.currentTarget) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
  }} className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-slate-950/65 backdrop:backdrop-blur-sm">
    <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-5 sm:px-6"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-brand">Account security</p><h2 id={id + '-title'} className="mt-1 text-xl font-bold tracking-tight">Change my password</h2></div><button type="button" disabled={busy} onClick={onClose} aria-label="Close password settings" className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="size-5"><path d="m6 6 12 12M18 6 6 18" /></svg></button></div>
    <form onSubmit={submit} className="space-y-4 p-5 sm:p-6" aria-busy={busy}>
      <p id={id + '-description'} className="text-sm leading-6 text-muted">Use at least 12 characters. After saving, sign in again with your new password. Attendance timers will not stop.</p>
      <div><label htmlFor={id + '-current'} className="text-sm font-semibold">Current password</label><input ref={currentField} id={id + '-current'} type="password" required maxLength={128} autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} className={field} /></div>
      <div><label htmlFor={id + '-next'} className="text-sm font-semibold">New password</label><input id={id + '-next'} type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} className={field} /></div>
      <div><label htmlFor={id + '-confirm'} className="text-sm font-semibold">Confirm new password</label><input id={id + '-confirm'} type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} className={field} /></div>
      {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-xl border border-line px-4 text-sm font-semibold hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50">Cancel</button><button type="submit" disabled={busy} className="min-h-11 rounded-xl bg-[#4f46e5] px-5 text-sm font-semibold text-white hover:bg-[#4338ca] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50">{busy ? 'Updating…' : 'Save password'}</button></div>
    </form>
  </dialog>, document.body)
}
