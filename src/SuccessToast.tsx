import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SUCCESS_TOAST_EVENT } from './successNotifications'

type Toast = { id: number; message: string }

export default function SuccessToast() {
  const [toast, setToast] = useState<Toast | null>(null)
  const sequence = useRef(0)

  useEffect(() => {
    const show = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'string' || !event.detail.trim()) return
      setToast({ id: ++sequence.current, message: event.detail })
    }
    window.addEventListener(SUCCESS_TOAST_EVENT, show)
    return () => window.removeEventListener(SUCCESS_TOAST_EVENT, show)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => {
      setToast(current => current?.id === toast.id ? null : current)
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [toast])

  return createPortal(
    <div role="status" aria-live="polite" aria-atomic="true" data-success-toast className="pointer-events-none fixed inset-x-4 top-5 z-[100] flex justify-center pt-[env(safe-area-inset-top)] sm:inset-x-auto sm:right-6 sm:top-6">
      {toast && <div key={toast.id} className="flex max-w-sm animate-[success-toast_1.2s_ease-in-out_both] items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-sans text-sm font-medium text-emerald-900 shadow-lg shadow-black/10 motion-reduce:animate-none dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5 shrink-0"><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></svg>
        <span className="min-w-0 break-words">{toast.message}</span>
      </div>}
    </div>,
    document.body,
  )
}
