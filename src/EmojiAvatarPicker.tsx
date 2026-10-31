import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './supabase'
import EmojiAvatar from './EmojiAvatar'
import { emojiAvatarGroups, getAvatarEmoji } from './emojiAvatars'

export default function EmojiAvatarPicker({ value, onSaved, onClose }: {
  value: unknown; onSaved: (emoji: string) => void; onClose: () => void
}) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const initialChoice = useRef<HTMLButtonElement>(null)
  const saving = useRef(false)
  const currentEmoji = getAvatarEmoji(value)
  const [selected, setSelected] = useState(currentEmoji)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    element?.showModal()
    initialChoice.current?.focus({ preventScroll: true })
    document.body.style.overflow = 'hidden'
    return () => {
      element?.close()
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || saving.current || selected === currentEmoji) return
    saving.current = true
    setBusy(true)
    setError('')
    try {
      const result = await supabase.rpc('set_own_avatar_emoji', { emoji: selected })
      if (result.error || result.data !== selected) {
        setError('Could not save your profile emoji. Please try again.')
        return
      }
      onSaved(selected)
      onClose()
    } catch {
      setError('Could not reach the profile service. Check your connection and try again.')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return createPortal(<dialog ref={dialog} aria-labelledby={id + '-title'} aria-describedby={id + '-description'} onCancel={event => { event.preventDefault(); if (!saving.current) onClose() }} onClick={event => {
    if (saving.current || event.target !== event.currentTarget) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
  }} className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface p-0 font-sans text-ink shadow-2xl backdrop:bg-slate-950/65 backdrop:backdrop-blur-sm">
    <div className="flex items-start justify-between gap-3 border-b border-line p-5 sm:px-6">
      <div><h2 id={id + '-title'} className="text-xl font-bold tracking-tight">Choose your profile emoji</h2><p id={id + '-description'} className="mt-1 text-xs leading-5 text-muted">Pick an emoji for your account. No photos or uploads.</p></div>
      <button type="button" disabled={busy} onClick={onClose} aria-label="Close emoji picker" className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="size-5"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
    </div>
    <form onSubmit={save} aria-busy={busy}>
      <div className="flex items-center gap-4 border-b border-line bg-soft/50 px-5 py-4 sm:px-6"><EmojiAvatar value={selected} className="size-14 bg-brand/10 text-3xl" /><div><p className="text-sm font-semibold">Your profile picture</p><p className="mt-1 text-xs leading-5 text-muted">Shown everywhere your employee avatar appears.</p></div></div>
      <div className="space-y-5 p-5 sm:px-6">
        {emojiAvatarGroups.map(group => <fieldset key={group.label} disabled={busy} className="min-w-0"><legend className="mb-2 text-xs font-semibold text-muted">{group.label}</legend><div className="grid grid-cols-4 gap-2 min-[400px]:grid-cols-6">{group.choices.map(choice => <button key={choice.emoji} ref={choice.emoji === currentEmoji ? initialChoice : undefined} type="button" aria-label={choice.label} title={choice.label} aria-pressed={selected === choice.emoji} onClick={() => { setSelected(choice.emoji); setError('') }} className={'grid min-h-11 place-items-center rounded-xl border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50 ' + (selected === choice.emoji ? 'border-brand bg-brand/10 ring-1 ring-brand' : 'border-transparent bg-soft hover:border-line hover:bg-brand/5')}><EmojiAvatar value={choice.emoji} className="size-9 text-2xl" /></button>)}</div></fieldset>)}
        {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      </div>
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-surface px-5 py-4 sm:px-6"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-xl border border-line px-4 text-sm font-semibold hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50">Cancel</button><button type="submit" disabled={busy || selected === currentEmoji} className="min-h-11 rounded-xl bg-[#4f46e5] px-5 text-sm font-semibold text-white hover:bg-[#4338ca] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50">{busy ? 'Saving…' : 'Save emoji'}</button></div>
    </form>
  </dialog>, document.body)
}
