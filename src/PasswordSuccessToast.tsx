import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export default function PasswordSuccessToast() {
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setExpired(true), 1200)
    return () => window.clearTimeout(timer)
  }, [])

  if (expired) return null

  return createPortal(
    <div className="pointer-events-none fixed inset-x-4 top-5 z-[100] flex justify-center pt-[env(safe-area-inset-top)] sm:inset-x-auto sm:right-6 sm:top-6">
      <div role="status" aria-atomic="true" className="flex max-w-full animate-[password-toast_1.2s_ease-in-out_both] items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-sans text-sm font-medium text-emerald-900 shadow-lg shadow-black/10 motion-reduce:animate-none dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5 shrink-0"><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></svg>
        Password changed successfully.
      </div>
    </div>,
    document.body,
  )
}
