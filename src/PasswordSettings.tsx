import { useId, useState, type FormEvent } from 'react'
import { supabase } from './supabase'

export default function PasswordSettings({ onChanged }: { onChanged: () => void }) {
  const id = useId()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
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
      onChanged()
    } catch { setError('Password service is temporarily unavailable.') }
    finally { setBusy(false) }
  }
  return <section className="rounded-2xl border border-line bg-surface p-5 text-ink sm:p-6">
    <h2 className="text-lg font-bold">Change password</h2>
    <p className="mt-2 text-sm leading-6 text-muted">Use at least 12 characters. After saving, sign in again with your new password. Attendance timers will not stop.</p>
    <form onSubmit={submit} className="mt-5 max-w-md space-y-4">
      <div><label htmlFor={id + '-current'} className="text-sm font-semibold">Current password</label><input id={id + '-current'} type="password" required maxLength={128} autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} className={field} /></div>
      <div><label htmlFor={id + '-next'} className="text-sm font-semibold">New password</label><input id={id + '-next'} type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} className={field} /></div>
      <div><label htmlFor={id + '-confirm'} className="text-sm font-semibold">Confirm new password</label><input id={id + '-confirm'} type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} className={field} /></div>
      {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      <button type="submit" disabled={busy} className="min-h-11 rounded-xl bg-[#4f46e5] px-5 text-sm font-semibold text-white hover:bg-[#4338ca] disabled:opacity-50">{busy ? 'Updating…' : 'Save password'}</button>
    </form>
  </section>
}
