import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode, type UIEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { useAttendance, useAttendanceHistory, type Shift } from './attendance'
import PasswordSettings from './PasswordSettings'
import PasswordSuccessToast from './PasswordSuccessToast'

const PhoneNumberInput = lazy(() => import('./PhoneNumberInput'))
const FormattedPhone = lazy(() => import('./FormattedPhone'))

type Page = 'dashboard' | 'profile'
type Theme = 'light' | 'dark'
type RememberedAccount = { email: string; name: string }
type EmployeeProfile = {
  id: string
  full_name: string
  position: string | null
  phone_number: string | null
  is_active: boolean
  must_change_password: boolean
  terminated_at: string | null
}

const THEME_KEY = 'tlc-preview-theme-v1'
const REMEMBERED_ACCOUNT_KEY = 'tlc-remembered-account-v1'

function accountFromUser(user: User): RememberedAccount | null {
  if (!user.email) return null
  const fullName = user.user_metadata?.full_name
  return {
    email: user.email,
    name: typeof fullName === 'string' && fullName.trim()
      ? fullName.trim() : user.email.split('@')[0],
  }
}

function loadRememberedAccount(): RememberedAccount | null {
  try {
    const saved = localStorage.getItem(REMEMBERED_ACCOUNT_KEY)
    if (!saved) return null
    const value: unknown = JSON.parse(saved)
    if (typeof value !== 'object' || value === null || !('email' in value) || !('name' in value)) return null
    if (typeof value.email !== 'string' || typeof value.name !== 'string') return null
    if (!value.email.includes('@') || value.email.length > 254 || value.name.length > 100) return null
    return { email: value.email, name: value.name }
  } catch {
    return null
  }
}

const panel = 'min-w-0 rounded-2xl border border-line bg-surface shadow-sm'
const eyebrow = 'mb-2 block text-[11px] font-extrabold tracking-[0.17em] text-brand'
const focusRing = 'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-indigo-300'
const avatar = 'grid shrink-0 place-items-center rounded-full bg-[#e8e7ff] font-bold text-[#4f4fe2]'
const muted = 'text-muted'

function loadTheme(): Theme {
  try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light' }
  catch { return 'light' }
}

function dateLabel(value: string | Date, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', options ?? {
    month: 'short', day: 'numeric', year: 'numeric',
  }).format(new Date(value))
}

function timeLabel(value: string | Date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(value))
}

function duration(milliseconds: number, seconds = false) {
  const total = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const two = (value: number) => String(value).padStart(2, '0')
  return seconds
    ? [two(hours), two(minutes), two(total % 60)].join(':')
    : hours + 'h ' + two(minutes) + 'm'
}

function shiftOverlap(shift: Shift, from: number, to: number) {
  const start = new Date(shift.clockIn).getTime()
  const end = shift.clockOut ? new Date(shift.clockOut).getTime() : to
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, Math.min(end, to) - Math.max(start, from))
    : 0
}

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const props = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }
  switch (name) {
    case 'grid': return <svg {...props}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
    case 'user': return <svg {...props}><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></svg>
    case 'clock': return <svg {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>
    case 'calendar': return <svg {...props}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18" /></svg>
    case 'arrow': return <svg {...props}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    case 'check': return <svg {...props}><path d="m5 12 4 4L19 6" /></svg>
    case 'sun': return <svg {...props}><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>
    case 'moon': return <svg {...props}><path d="M20 15.4A8 8 0 0 1 8.6 4 8 8 0 1 0 20 15.4Z" /></svg>
    case 'mail': return <svg {...props}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></svg>
    case 'phone': return <svg {...props}><path d="M5 3h4l1 5-2 2a15 15 0 0 0 6 6l2-2 5 1v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z" /></svg>
    case 'briefcase': return <svg {...props}><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13a17 17 0 0 0 18 0" /></svg>
    case 'refresh': return <svg {...props}><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.6-2L20 8M4 16l2.3 3A7 7 0 0 0 17.9 17" /></svg>
    default: return null
  }
}

function AttendanceTable({ shifts, now, scrollable = false, onReachEnd, hasMore = false, loadingMore = false }: {
  shifts: Shift[]
  now: number
  scrollable?: boolean
  onReachEnd?: () => void
  hasMore?: boolean
  loadingMore?: boolean
}) {
  if (!shifts.length) {
    return <p className="py-9 text-center text-sm text-muted">No shifts yet. Clock in to create your first record.</p>
  }
  return (
    <div onScroll={onReachEnd ? (event: UIEvent<HTMLDivElement>) => {
      const area = event.currentTarget
      if (area.scrollTop + area.clientHeight >= area.scrollHeight - 80) onReachEnd()
    } : undefined} className={scrollable
      ? 'h-[350px] w-full max-w-full overflow-auto [contain:inline-size] sm:h-[380px]'
      : 'w-full max-w-full overflow-x-auto'}>
      <table className="w-full min-w-[540px] border-collapse text-left text-[13px] whitespace-nowrap">
        <thead>
          <tr>
            {['Date', 'Clock in', 'End time', 'Duration', 'Status'].map((heading) => (
              <th key={heading} scope="col" className="sticky top-0 z-10 bg-soft px-3 py-3 text-[11px] font-extrabold tracking-[0.09em] text-muted uppercase">{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shifts.map((shift) => (
            <tr key={shift.id} className="border-b border-line last:border-0">
              <td className="px-3 py-4 font-bold text-ink">{dateLabel(shift.clockIn, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</td>
              <td className="px-3 py-4 text-muted">{timeLabel(shift.clockIn)}</td>
              <td className="px-3 py-4 text-muted">{shift.clockOut ? timeLabel(shift.clockOut) : '—'}</td>
              <td className="px-3 py-4 text-muted">{duration(shiftOverlap(shift, new Date(shift.clockIn).getTime(), now))}</td>
              <td className="px-3 py-4">
                <span className={'inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 text-[11px] font-bold ' + (
                  shift.endReason === 'terminated' ? 'bg-rose-50 text-rose-800 dark:bg-rose-400/10 dark:text-rose-200' : shift.clockOut
                    ? 'bg-[#eaf8ef] text-[#207b52] dark:bg-[#1d4a3d] dark:text-[#8de6b8]'
                    : 'bg-[#edeaff] text-[#594dc4] dark:bg-[#3e3a72] dark:text-[#c3baff]'
                )}>
                  <span className="size-1.5 rounded-full bg-current" />
                  {shift.endReason === 'terminated' ? 'Terminated' : shift.clockOut ? 'Completed' : 'On duty'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {scrollable && (loadingMore || hasMore) && <p className="p-3 text-center text-xs text-muted">{loadingMore ? 'Loading more records…' : 'Scroll for older records'}</p>}
    </div>
  )
}

function ProfileDetail({ icon, label, value }: { icon: string; label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-t border-line py-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-soft text-brand"><Icon name={icon} size={19} /></span>
      <div className="min-w-0">
        <span className="mb-1 block text-[11px] text-muted">{label}</span>
        <strong className="block break-words text-sm text-ink">{value}</strong>
      </div>
    </div>
  )
}

function ContactEditor({ user, profile, onUserUpdated, onPhoneUpdated }: {
  user: User
  profile: EmployeeProfile
  onUserUpdated: (updated: User) => void
  onPhoneUpdated: (phone: string) => void
}) {
  const [email, setEmail] = useState(user.email ?? '')
  const [emailPassword, setEmailPassword] = useState('')
  const [phone, setPhone] = useState(profile.phone_number ?? '')
  const [emailBusy, setEmailBusy] = useState(false)
  const [phoneBusy, setPhoneBusy] = useState(false)
  const [emailNotice, setEmailNotice] = useState('')
  const [emailError, setEmailError] = useState('')
  const [phoneNotice, setPhoneNotice] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const input = 'min-h-12 w-full rounded-xl border border-line bg-soft px-4 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'
  const save = 'min-h-10 rounded-xl bg-[#4f4ff1] px-4 text-xs font-bold text-white hover:bg-[#4141d5] disabled:cursor-not-allowed disabled:opacity-50 ' + focusRing

  async function saveEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || emailBusy) return
    const next = email.trim().toLowerCase()
    setEmailNotice('')
    setEmailError('')
    if (next === user.email?.toLowerCase()) { setEmailNotice('Your email is unchanged.'); return }
    if (next.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) { setEmailError('Enter a valid email address.'); return }
    if (!emailPassword) { setEmailError('Enter your current password to change your email.'); return }
    setEmailBusy(true)
    try {
      const result = await supabase.functions.invoke('admin-api', {
        body: { action: 'change-email', email: next, currentPassword: emailPassword },
      })
      if (result.error || result.data?.email?.toLowerCase() !== next) {
        setEmailError(result.data?.message === 'Current password is incorrect.'
          ? 'Current password is incorrect.' : 'Could not change your email. Check the address and try again.')
        return
      }
      setEmailPassword('')
      const refreshed = await supabase.auth.refreshSession()
      onUserUpdated(refreshed.data.user ?? { ...user, email: next })
      setEmailNotice('Email address updated. Use it the next time you sign in.')
    } catch {
      setEmailError('Email changes are temporarily unavailable. Please try again.')
    } finally {
      setEmailBusy(false)
    }
  }

  async function savePhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || phoneBusy) return
    setPhoneNotice('')
    setPhoneError('')
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) { setPhoneError('Choose a country and enter a phone number.'); return }
    if (phone === profile.phone_number) { setPhoneNotice('Your phone number is unchanged.'); return }
    setPhoneBusy(true)
    try {
      const { data, error } = await supabase.from('employee_profiles')
        .update({ phone_number: phone }).eq('id', user.id).select('phone_number').single()
      if (error || !data?.phone_number) { setPhoneError('Could not save your phone number. Please try again.'); return }
      onPhoneUpdated(data.phone_number)
      setPhoneNotice('Phone number updated.')
    } catch {
      setPhoneError('Phone updates are temporarily unavailable. Please try again.')
    } finally {
      setPhoneBusy(false)
    }
  }

  return <div className="col-span-full space-y-5 border-t border-line pt-5">
    <form onSubmit={saveEmail} className="space-y-2">
      <label htmlFor="profile-email" className="block text-sm font-semibold text-ink">Email address</label>
      <input id="profile-email" type="email" required maxLength={254} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className={input} />
      <p className="text-xs leading-5 text-muted">Changes immediately without an email link. Check the address carefully so you can sign in next time.</p>
      <label htmlFor="profile-email-password" className="block text-sm font-semibold text-ink">Current password</label>
      <input id="profile-email-password" type="password" required autoComplete="current-password" value={emailPassword} onChange={event => setEmailPassword(event.target.value)} className={input} />
      {emailError && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{emailError}</p>}
      {emailNotice && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-300">{emailNotice}</p>}
      <button type="submit" disabled={emailBusy} className={save}>{emailBusy ? 'Saving…' : 'Save email'}</button>
    </form>
    <form onSubmit={savePhone} className="space-y-2 border-t border-line pt-5">
      <label htmlFor="profile-phone" className="block text-sm font-semibold text-ink">Phone number</label>
      <Suspense fallback={<p role="status" className="py-3 text-xs text-muted">Loading phone editor…</p>}>
        <PhoneNumberInput value={phone} onChange={setPhone} />
      </Suspense>
      <p className="text-xs leading-5 text-muted">Choose your country, then enter your number.</p>
      {phoneError && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{phoneError}</p>}
      {phoneNotice && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-300">{phoneNotice}</p>}
      <button type="submit" disabled={phoneBusy} className={save}>{phoneBusy ? 'Saving…' : 'Save phone'}</button>
    </form>
  </div>
}

function EmployeeDashboard({ user, profile, theme, setTheme, onUserUpdated, onPhoneUpdated, onLogout, logoutBusy, logoutError }: {
  user: User
  profile: EmployeeProfile
  theme: Theme
  setTheme: (theme: Theme) => void
  onUserUpdated: (updated: User) => void
  onPhoneUpdated: (phone: string) => void
  onLogout: () => void
  logoutBusy: boolean
  logoutError: string
}) {
  const fullName = profile.full_name.trim() || user.email?.split('@')[0] || 'Employee'
  const employee = {
    fullName,
    position: profile.position?.trim() || 'Not provided',
    userId: user.id,
    email: user.email || 'Not provided',
    phone: profile.phone_number?.trim() || 'Not provided',
  }
  const initials = fullName.split(/\s+/).slice(0, 2).map((word: string) => word[0]?.toUpperCase()).join('') || 'E'
  const [page, setPage] = useState<Page>('dashboard')
  const [editingContact, setEditingContact] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [passwordSavedVersion, setPasswordSavedVersion] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const refreshBusy = useRef(false)
  const attendance = useAttendance(user.id)
  const history = useAttendanceHistory(user.id, attendance.version, page === 'profile')
  const now = attendance.now ?? 0
  const active = attendance.active
  const latestShift = active ?? attendance.recentShifts[0] ?? null
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const monday = new Date(today)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const todayTotal = attendance.dashboardShifts.reduce((sum, shift) => sum + shiftOverlap(shift, today.getTime(), now), 0)
  const weekTotal = attendance.dashboardShifts.reduce((sum, shift) => sum + shiftOverlap(shift, monday.getTime(), now), 0)
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time'

  function openProfile() {
    setPage('profile')
    window.scrollTo(0, 0)
  }

  async function refreshDashboard() {
    if (refreshBusy.current) return
    refreshBusy.current = true
    setRefreshing(true)
    setPage('dashboard')
    window.scrollTo(0, 0)
    try { await attendance.refresh() }
    finally { refreshBusy.current = false; setRefreshing(false) }
  }

  if (attendance.loading && attendance.now === null) {
    return <div role="status" className="grid min-h-screen place-items-center bg-page px-5 font-sans text-sm text-muted">Loading your attendance…</div>
  }
  if (attendance.now === null) {
    return <div className="grid min-h-screen place-items-center bg-page px-5 py-10 font-sans text-ink"><div className="w-full max-w-md rounded-2xl border border-line bg-surface p-7 text-center shadow-sm"><h1 className="text-xl font-bold">Attendance is unavailable</h1><p role="alert" className="mt-3 text-sm leading-6 text-muted">{attendance.error || 'The server clock could not be verified.'}</p><div className="mt-6 flex justify-center gap-3"><button type="button" onClick={() => void attendance.refresh()} className={'min-h-11 rounded-xl bg-[#4f4ff1] px-5 text-sm font-bold text-white ' + focusRing}>Retry</button><button type="button" onClick={onLogout} className={'min-h-11 rounded-xl border border-line px-5 text-sm font-bold ' + focusRing}>Sign out</button></div></div></div>
  }

  const hour = new Date(now).getHours()
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
  const navBase = 'flex min-w-0 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold text-white/85 transition-colors hover:bg-white/15 hover:text-white md:justify-start md:gap-3 md:px-4 md:py-3 md:text-sm ' + focusRing

  return (
    <div className="min-h-screen bg-page font-sans text-ink md:grid md:grid-cols-[230px_minmax(0,1fr)] xl:grid-cols-[254px_minmax(0,1fr)]">
      <aside className="flex flex-wrap items-center gap-2 bg-[#4f4ff1] px-4 py-3 text-white dark:bg-[#27276f] md:sticky md:top-0 md:h-screen md:min-h-screen md:flex-col md:items-stretch md:gap-0 md:overflow-y-auto md:px-4 md:py-7" aria-label="Main navigation">
        <button type="button" onClick={() => void refreshDashboard()} disabled={refreshing} aria-label="Refresh dashboard" aria-busy={refreshing} title="Refresh dashboard" className={'flex w-full items-center gap-2.5 rounded-xl text-left transition-colors hover:bg-white/10 disabled:cursor-progress md:mb-12 md:w-auto md:px-2 ' + focusRing}>
          <span className="grid size-11 shrink-0 place-items-center rounded-[13px] border border-white/20 bg-white/20 text-[17px] font-extrabold tracking-[-1px]">{refreshing ? <span className="motion-safe:animate-spin"><Icon name="refresh" size={21} /></span> : 'TLC'}</span>
          <span className="min-w-0 text-[13px] font-bold leading-tight md:text-[15px]">Tech Live Connect<small className="mt-1 block text-[10px] font-normal text-white/75 md:text-[11px]">Employee workspace</small></span>
        </button>
        <span role="status" className="sr-only">{refreshing ? 'Refreshing dashboard…' : ''}</span>
        <span className="mb-3 hidden px-4 text-[10px] font-bold tracking-[0.18em] text-white/70 md:block">WORKSPACE</span>
        <nav className="grid w-full min-w-0 grid-cols-2 gap-1 md:flex md:flex-col md:gap-2" aria-label="Pages">
          <button type="button" className={navBase + (page === 'dashboard' ? ' bg-white/20 text-white ring-1 ring-white/10' : '')} onClick={() => setPage('dashboard')} aria-current={page === 'dashboard' ? 'page' : undefined}><Icon name="grid" size={18} />Dashboard</button>
          <button type="button" className={navBase + (page === 'profile' ? ' bg-white/20 text-white ring-1 ring-white/10' : '')} onClick={() => setPage('profile')} aria-current={page === 'profile' ? 'page' : undefined}><Icon name="user" size={18} />My profile</button>
        </nav>
        <div className="w-full min-w-0 md:mt-auto">
          <div className="mb-6 hidden rounded-2xl border border-white/15 bg-white/10 px-4 py-4 md:block">
            <span className="mb-3 grid size-8 place-items-center rounded-lg bg-white/15"><Icon name="clock" size={17} /></span>
            <strong className="block text-sm">Time that stays with you.</strong>
            <p className="mt-2 text-xs leading-relaxed text-white/80">Your active shift stays on the server when you close this page or sign out.</p>
          </div>
          <div className="grid grid-cols-2 items-center gap-x-2 gap-y-1 border-t border-white/20 px-1 pt-3 md:block md:pt-4">
            <button type="button" onClick={openProfile} aria-label="Open my profile" className={'col-span-2 flex min-h-11 min-w-0 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/15 ' + focusRing}><span className={avatar + ' size-9 shrink-0 text-[11px]'}>{initials}</span><span className="min-w-0"><strong className="block truncate text-[13px]">{employee.fullName}</strong><small className="mt-0.5 block truncate text-[11px] text-white/75">{employee.position}</small></span></button>
            <button type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={'Switch to ' + (theme === 'light' ? 'dark' : 'light') + ' mode'} className={'flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-white/85 transition hover:bg-white/15 hover:text-white md:mt-2 md:w-full ' + focusRing}><Icon name={theme === 'light' ? 'sun' : 'moon'} size={16} /><span>Appearance</span><span className="ml-auto rounded-md border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] text-white/80">{theme === 'light' ? 'Light' : 'Dark'}</span></button>
            <button type="button" onClick={() => setPasswordOpen(true)} aria-haspopup="dialog" className={'flex min-h-11 items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-white/85 transition hover:bg-white/15 hover:text-white md:mt-2 md:w-full ' + focusRing}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0"><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9m-3 3 3 3m-6 0 3 3" /></svg>
              Change my password
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex h-16 items-center justify-between gap-3 border-b border-line bg-surface px-4 md:h-[78px] md:px-8 xl:px-12">
          <span className="min-w-0 truncate text-xs text-muted md:text-[13px]">Workspace <span className="mx-2 text-muted/60">/</span> <strong className="font-semibold text-ink">{page === 'dashboard' ? 'Dashboard' : 'My profile'}</strong></span>
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            <span className={'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[11px] font-semibold sm:px-3 sm:text-xs ' + (attendance.error ? 'bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-200' : active ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-200' : 'bg-soft text-muted')} title={attendance.error ? 'Attendance could not be refreshed. Retry below.' : active ? 'Your shift is in progress' : 'You have no active shift'}><span className="size-1.5 rounded-full bg-current" />{attendance.error ? 'Sync unavailable' : active ? 'On duty' : 'Off duty'}</span>
            <button type="button" disabled={logoutBusy} onClick={onLogout} className={'rounded-lg border border-line bg-surface px-3 py-2 text-xs font-bold text-ink hover:bg-soft disabled:opacity-60 ' + focusRing}>{logoutBusy ? 'Signing out…' : 'Sign out'}</button>
            <button type="button" onClick={openProfile} aria-label="Open my profile from header" title="My profile" className={avatar + ' hidden size-9 text-[11px] transition-shadow hover:ring-2 hover:ring-brand/30 sm:grid ' + focusRing}>{initials}</button>
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 md:px-8 md:py-9 xl:px-12">
          {logoutError && <p role="alert" className="mb-4 rounded-lg border border-rose-400 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">{logoutError}</p>}
          {attendance.error && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-400 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200"><span>{attendance.error}</span><button type="button" onClick={() => void attendance.refresh()} className={'font-bold underline ' + focusRing}>Retry</button></div>}
          {page === 'dashboard' ? (
            <>
              <div className="mb-7 flex flex-col items-start gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h1 className="text-[27px] leading-tight font-bold tracking-[-0.04em] sm:text-[31px]">Good {greeting}, {employee.fullName.split(' ')[0]} <span className="text-[#eeb256]" aria-hidden="true">✳</span></h1>
                  <p className={'mt-2 text-[15px] ' + muted}>Here’s your workday at a glance.</p>
                </div>
                <div className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl border border-line bg-surface px-3 py-2.5 text-xs font-semibold text-muted shadow-sm"><Icon name="calendar" size={18} />{dateLabel(new Date(now), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
              </div>

              <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4" aria-label="Attendance summary">
                <div className={panel + ' min-h-[142px] p-4 sm:min-h-[165px] sm:p-5'}>
                  <span className="mb-3 grid size-9 place-items-center rounded-lg bg-[#ecebff] text-[#5451e6]"><Icon name="clock" /></span>
                  <span className="block text-xs font-semibold text-muted sm:text-[13px]">Hours worked today</span>
                  <strong className="mt-1 block text-[22px] leading-tight tracking-tight sm:text-[26px]">{duration(todayTotal)}</strong>
                  <small className="mt-1 block break-words text-[10px] text-muted sm:text-xs">Since midnight · {timeZone}</small>
                </div>
                <div className={panel + ' min-h-[142px] p-4 sm:min-h-[165px] sm:p-5'}>
                  <span className="mb-3 grid size-9 place-items-center rounded-lg bg-[#e9f1ff] text-[#4177ce]"><Icon name="calendar" /></span>
                  <span className="block text-xs font-semibold text-muted sm:text-[13px]">Hours this week</span>
                  <strong className="mt-1 block text-[22px] leading-tight tracking-tight sm:text-[26px]">{duration(weekTotal)}</strong>
                  <small className="mt-1 block text-[10px] text-muted sm:text-xs">Monday through Sunday</small>
                </div>
                <div className={panel + ' col-span-2 min-h-[115px] p-4 lg:col-span-1 lg:min-h-[165px] lg:p-5'}>
                  <span className="mb-2 grid size-9 place-items-center rounded-lg bg-[#e4f7ef] text-[#158558] lg:mb-3"><Icon name="check" /></span>
                  <span className="block text-xs font-semibold text-muted sm:text-[13px]">Current status</span>
                  <strong className="mt-1 flex items-center gap-2 text-[22px] leading-tight tracking-tight sm:text-[26px]"><span className={'size-2.5 rounded-full ' + (active ? 'bg-emerald-500 ring-4 ring-emerald-500/15' : 'bg-slate-400')} />{active ? 'On duty' : 'Off duty'}</strong>
                  <small className="mt-1 block text-[10px] text-muted sm:text-xs">{active ? 'Shift in progress' : 'Ready for your next shift'}</small>
                </div>
              </section>

              <section className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(285px,1fr)]">
                <div className="flex min-h-[330px] min-w-0 flex-col overflow-hidden rounded-[18px] bg-[linear-gradient(135deg,#5351f1,#3539c5)] text-white shadow-lg shadow-indigo-500/10">
                  <div className="flex items-center justify-between gap-2 px-5 pt-5 sm:px-7">
                    <span className="flex items-center gap-2 text-[11px] font-extrabold tracking-[0.13em] text-white/90"><Icon name="clock" size={18} />TIME TRACKER</span>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/20 bg-white/15 px-2.5 py-1.5 text-[11px] font-semibold"><span className={'size-1.5 rounded-full ' + (active ? 'bg-emerald-200' : 'bg-indigo-200')} />{active ? 'Currently working' : 'Not clocked in'}</span>
                  </div>
                  <div className="flex flex-1 flex-col items-center justify-center px-3 py-5 text-center">
                    <span className="text-sm text-white/85">{active ? 'Your active shift' : 'Ready when you are'}</span>
                    <div className="my-2 text-[clamp(38px,5vw,59px)] leading-tight font-bold tracking-[0.02em] tabular-nums">{active ? duration(now - new Date(active.clockIn).getTime(), true) : timeLabel(new Date(now))}</div>
                    <p className="mb-5 text-[13px] text-white/85">{active ? 'Started at ' + timeLabel(active.clockIn) + ' · ' + dateLabel(active.clockIn) : 'Start your shift when you’re ready to work.'}</p>
                    <button type="button" disabled={attendance.busy || attendance.now === null || Boolean(attendance.error)} className={'inline-flex min-h-11 min-w-36 items-center justify-center gap-3 rounded-xl bg-white px-5 text-sm font-extrabold shadow-lg shadow-indigo-950/10 transition-transform hover:-translate-y-0.5 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60 ' + (active ? 'text-rose-700 ' : 'text-indigo-700 ') + focusRing} onClick={() => void attendance.toggleShift()}>{attendance.busy ? 'Saving…' : active ? 'Clock out' : 'Clock in'}<Icon name="arrow" size={18} /></button>
                  </div>
                  <div className="flex items-center justify-center gap-2 border-t border-white/20 px-3 py-3 text-center text-[11px] text-white/80"><Icon name="check" size={15} />{active ? 'Elapsed time continues while you’re away.' : 'Clock events use server time.'}</div>
                </div>

                <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-1">
                  <div className={panel + ' p-5'}>
                    <div className="flex items-center justify-between gap-3"><h2 className="text-[19px] font-semibold tracking-tight">Your profile</h2><button type="button" className={'inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-bold text-brand hover:underline ' + focusRing} onClick={() => setPage('profile')}>View profile<Icon name="arrow" size={15} /></button></div>
                    <div className="mt-6 flex items-center gap-3">
                      <span className={avatar + ' size-14 text-[17px]'}>{initials}</span>
                      <div><strong className="block text-[15px]">{employee.fullName}</strong><span className="mt-0.5 block text-xs text-muted">{employee.position}</span><small className="mt-1 block text-[11px] font-bold text-brand">{employee.userId}</small></div>
                    </div>
                    <div className="my-4 border-t border-line" />
                    <div className="flex items-center gap-2.5 break-all text-xs text-muted"><span className="text-brand"><Icon name="mail" size={17} /></span>{employee.email}</div>
                    <div className="mt-3 flex items-center gap-2.5 text-xs text-muted"><span className="text-brand"><Icon name="phone" size={17} /></span>{employee.phone}</div>
                  </div>
                  <section className={panel + ' p-5'} aria-labelledby="shift-details-title">
                    <div className="flex items-center justify-between gap-3"><h2 id="shift-details-title" className="text-sm font-semibold">{active ? 'Current shift' : 'Last shift'}</h2><button type="button" onClick={openProfile} className={'inline-flex items-center gap-1 text-xs font-bold text-brand hover:underline ' + focusRing}>View records<Icon name="arrow" size={14} /></button></div>
                    {latestShift ? <dl className="mt-4 grid grid-cols-2 gap-4">
                      <div><dt className="text-[11px] text-muted">Clock in</dt><dd className="mt-1 text-sm font-semibold"><time dateTime={latestShift.clockIn}>{timeLabel(latestShift.clockIn)}</time><span className="mt-1 block text-[10px] font-normal text-muted">{dateLabel(latestShift.clockIn)}</span></dd></div>
                      <div><dt className="text-[11px] text-muted">{latestShift.endReason === 'terminated' ? 'Shift ended' : 'Clock out'}</dt><dd className="mt-1 text-sm font-semibold">{latestShift.clockOut ? <><time dateTime={latestShift.clockOut}>{timeLabel(latestShift.clockOut)}</time><span className="mt-1 block text-[10px] font-normal text-muted">{dateLabel(latestShift.clockOut)}</span></> : <span className="text-emerald-700 dark:text-emerald-300">In progress</span>}</dd></div>
                    </dl> : <p className="mt-3 text-xs leading-5 text-muted">No attendance recorded yet. Your first clock-in will appear here.</p>}
                  </section>
                </div>
              </section>

              <section className={panel + ' px-4 pt-5 pb-3 sm:px-6'}>
                <div className="mb-4 flex items-end justify-between gap-3">
                  <div><span className={eyebrow}>YOUR ATTENDANCE</span><h2 className="text-[19px] font-semibold tracking-tight">Recent activity</h2></div>
                  <button type="button" className={'inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-bold text-brand hover:underline ' + focusRing} onClick={() => setPage('profile')}>View all records<Icon name="arrow" size={15} /></button>
                </div>
                <AttendanceTable shifts={attendance.recentShifts} now={now} />
              </section>
            </>
          ) : (
            <>
              <div className="mb-7"><h1 className="text-[27px] leading-tight font-bold tracking-[-0.04em] sm:text-[31px]">My profile</h1><p className="mt-2 text-[15px] text-muted">Your details and complete attendance history, all in one place.</p></div>
              <div className="mb-5 flex min-h-36 flex-wrap items-center gap-4 rounded-2xl bg-[linear-gradient(110deg,#5552ee,#3f42d6)] p-5 text-white sm:p-7">
                <span className="grid size-16 shrink-0 place-items-center rounded-full border-2 border-white/30 bg-white/20 text-xl font-bold sm:size-[75px]">{initials}</span>
                <div><h2 className="text-[25px] font-semibold tracking-tight">{employee.fullName}</h2><p className="text-[13px] text-white/85">{employee.position}</p></div>
                <span className="max-w-full break-all rounded-lg border border-white/30 bg-white/15 px-3 py-2 text-xs font-bold sm:ml-auto">{employee.userId}</span>
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(260px,.75fr)_minmax(0,1.5fr)]">
                <section className={panel + ' p-5 sm:grid sm:grid-cols-2 sm:gap-x-5 sm:p-6 xl:block'}>
                  <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:col-span-2"><div><span className={eyebrow}>ABOUT</span><h2 className="text-[19px] font-semibold tracking-tight">Personal information</h2></div><button type="button" onClick={() => setEditingContact(value => !value)} className={'text-xs font-bold text-brand hover:underline ' + focusRing}>{editingContact ? 'Done editing' : 'Edit contact details'}</button></div>
                  <ProfileDetail icon="user" label="Full name" value={employee.fullName} />
                  <ProfileDetail icon="briefcase" label="Position" value={employee.position} />
                  <ProfileDetail icon="grid" label="Unique user ID" value={employee.userId} />
                  {editingContact ? <ContactEditor user={user} profile={profile} onUserUpdated={onUserUpdated} onPhoneUpdated={onPhoneUpdated} /> : <><ProfileDetail icon="mail" label="Email address" value={employee.email} /><ProfileDetail icon="phone" label="Phone number" value={<Suspense fallback={employee.phone}><FormattedPhone value={employee.phone} /></Suspense>} /></>}
                  <ProfileDetail icon="calendar" label="Date registered" value={dateLabel(user.created_at)} />
                </section>
                <section className={panel + ' min-w-0 p-5 sm:p-6'}>
                  <div className="mb-5"><span className={eyebrow}>RECORDS</span><h2 className="text-[19px] font-semibold tracking-tight">Attendance history</h2><p className="mt-1 text-xs text-muted">Scroll to see all your shifts, newest first.</p></div>
                  {history.loading && !history.shifts.length && <p role="status" className="py-9 text-center text-sm text-muted">Loading your records…</p>}
                  {history.error && <p role="alert" className="mb-3 text-sm text-rose-700 dark:text-rose-300">{history.error} <button type="button" onClick={history.retry} className="font-bold underline">Retry</button></p>}
                  {(!history.loading || history.shifts.length > 0) && <AttendanceTable shifts={history.shifts} now={now} scrollable onReachEnd={history.loadMore} hasMore={history.hasMore} loadingMore={history.loading} />}
                  <p className="mt-3 border-t border-line pt-4 text-[11px] text-muted">Showing {history.shifts.length} {history.shifts.length === 1 ? 'record' : 'records'}{history.hasMore ? ' · Scroll for older records' : ''} · Times shown in {timeZone}</p>
                </section>
              </div>
            </>
          )}
          <footer className="mt-7 text-center text-[11px] text-muted">TLC Tech Live Connect <span className="mx-1">·</span> Employee attendance</footer>
        </main>
        {passwordSavedVersion > 0 && <PasswordSuccessToast key={passwordSavedVersion} />}
        {passwordOpen && <PasswordSettings onChanged={() => setPasswordSavedVersion(version => version + 1)} onClose={() => setPasswordOpen(false)} />}
      </div>
    </div>
  )
}

function LoginScreen({ theme, setTheme, rememberedAccount, onForgetAccount, onSignedIn, notice }: {
  theme: Theme
  setTheme: (theme: Theme) => void
  rememberedAccount: RememberedAccount | null
  onForgetAccount: () => void
  onSignedIn: (user: User) => void
  notice?: string
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const passwordRef = useRef<HTMLInputElement>(null)

  function selectAccount() {
    if (!rememberedAccount) return
    setEmail(rememberedAccount.email)
    setPassword('')
    setError('')
    passwordRef.current?.focus()
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || busy) return
    setError('')
    setBusy(true)
    try {
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (result.error) {
        setError('Could not sign in. Check your email and password and try again.')
        return
      }
      // Verify the identity with the Auth server before showing protected pages.
      const verified = await supabase.auth.getUser()
      if (verified.error || !verified.data.user) {
        setError('We could not verify your sign-in. Please try again.')
        return
      }
      onSignedIn(verified.data.user)
    } catch {
      setError('Sign-in is temporarily unavailable. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-page font-sans text-ink">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8 sm:py-7">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-[#4f4ff1] text-sm font-extrabold text-white shadow-sm">TLC</span>
          <span className="text-sm font-bold tracking-tight sm:text-base">Tech Live Connect</span>
        </div>
        <button type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={'Switch to ' + (theme === 'light' ? 'dark' : 'light') + ' mode'} className={'grid size-10 place-items-center rounded-xl border border-line bg-surface text-muted hover:text-brand ' + focusRing}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={19} /></button>
      </header>
      <main className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 pb-12 pt-8 sm:px-8 sm:pt-14 lg:min-h-[calc(100vh-100px)] lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] lg:gap-16 lg:pt-0">
        <div className="max-w-xl">
          <span className="mb-5 inline-flex rounded-full border border-[#dcdcff] bg-[#eeeeff] px-3 py-1.5 text-[11px] font-extrabold tracking-[0.13em] text-[#4f4fe2] dark:border-[#55548e] dark:bg-[#303052] dark:text-[#c6c4ff]">EMPLOYEE WORKSPACE</span>
          <h1 className="text-[clamp(2.35rem,5vw,4.2rem)] leading-[1.08] font-bold tracking-[-0.055em]">Your workday,<br /><span className="text-brand">all in one place.</span></h1>
          <p className="mt-5 max-w-md text-[15px] leading-7 text-muted sm:text-base">Sign in to view your dashboard, profile, and attendance records.</p>
          {rememberedAccount ? (
            <section aria-label="Remembered account" className="mt-9 max-w-md">
              <div className="mb-3 flex items-center justify-between gap-3"><span className="text-[11px] font-extrabold tracking-[0.14em] text-muted uppercase">Your account</span><button type="button" onClick={onForgetAccount} className={'text-xs font-semibold text-muted underline-offset-2 hover:text-brand hover:underline ' + focusRing}>Remove from this device</button></div>
              <button type="button" onClick={selectAccount} className={'flex w-full min-w-0 items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-left shadow-sm transition-colors hover:border-brand hover:bg-soft sm:p-5 ' + focusRing}>
                <span className={avatar + ' size-12 text-sm'}>{rememberedAccount.name.split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase()).join('')}</span>
                <span className="min-w-0 flex-1"><strong className="block truncate text-sm text-ink">Continue as {rememberedAccount.name}</strong><span className="mt-1 block truncate text-xs text-muted">{rememberedAccount.email}</span></span>
                <span className="shrink-0 text-brand"><Icon name="arrow" size={18} /></span>
              </button>
              <p className="mt-3 text-xs leading-5 text-muted">Your password is still required after signing out. We never save it here.</p>
            </section>
          ) : (
            <div className="mt-9 hidden max-w-md grid-cols-2 gap-3 sm:grid">
              <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm"><span className="mb-3 grid size-9 place-items-center rounded-lg bg-soft text-brand"><Icon name="clock" size={20} /></span><strong className="block text-sm">Track your shift</strong><span className="mt-1 block text-xs leading-5 text-muted">See your current status and elapsed time.</span></div>
              <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm"><span className="mb-3 grid size-9 place-items-center rounded-lg bg-soft text-brand"><Icon name="user" size={20} /></span><strong className="block text-sm">Your own space</strong><span className="mt-1 block text-xs leading-5 text-muted">View your profile and attendance history.</span></div>
            </div>
          )}
        </div>
        <section aria-labelledby="login-title" className="w-full rounded-[24px] border border-line bg-surface p-6 shadow-[0_18px_55px_-30px_rgba(35,40,90,.35)] sm:p-8">
          <span className="mb-5 grid size-11 place-items-center rounded-xl bg-[#eeedff] text-[#5552e6] dark:bg-[#34345e] dark:text-[#c6c4ff]"><Icon name="user" size={21} /></span>
          <h2 id="login-title" className="text-[27px] font-bold tracking-tight">Welcome back</h2>
          <p className="mt-2 text-sm leading-6 text-muted">Enter your employee credentials to continue.</p>
          {notice && <p role="status" className="mt-5 rounded-xl border border-line bg-soft p-3 text-sm">{notice}</p>}
          {!supabase && <p role="alert" className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-5 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">Sign-in is not configured yet. Add your Supabase project URL and publishable key to <code>.env.local</code>, then restart the app.</p>}
          {error && <p role="alert" className="mt-6 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm leading-5 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100">{error}</p>}
          <form onSubmit={signIn} className="mt-7 space-y-5">
            <div><label htmlFor="email" className="mb-2 block text-sm font-semibold">Email address</label><input id="email" type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" className={'min-h-12 w-full rounded-xl border border-line bg-soft px-4 text-sm text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 ' + focusRing} /></div>
            <div><label htmlFor="password" className="mb-2 block text-sm font-semibold">Password</label><div className="relative"><input ref={passwordRef} id="password" type={showPassword ? 'text' : 'password'} required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" className={'min-h-12 w-full rounded-xl border border-line bg-soft py-3 pr-19 pl-4 text-sm text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 ' + focusRing} /><button type="button" onClick={() => setShowPassword(!showPassword)} className={'absolute inset-y-0 right-2 px-2 text-xs font-bold text-brand hover:underline ' + focusRing} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button></div></div>
            <button type="submit" disabled={!supabase || busy} className={'flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#4f4ff1] px-5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#4141d5] disabled:cursor-not-allowed disabled:opacity-55 ' + focusRing}>{busy ? 'Signing in…' : 'Sign in'}{!busy && <Icon name="arrow" size={17} />}</button>
          </form>
          <p className="mt-6 text-center text-xs leading-5 text-muted">Need an account or a password reset? Contact your administrator.</p>
        </section>
      </main>
    </div>
  )
}

function FirstPasswordChange({ onSignOut, onDone }: { onSignOut: () => void; onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || busy) return
    if (next !== confirm) { setError('New passwords do not match.'); return }
    if (next.length < 12) { setError('Use at least 12 characters.'); return }
    setBusy(true)
    setError('')
    try {
      const result = await supabase.functions.invoke('admin-api', {
        body: { action: 'change-password', currentPassword: current, newPassword: next },
      })
      if (result.error) { setError('Could not change your password. Check your temporary password and try again.'); return }
      setCurrent(''); setNext(''); setConfirm('')
      onDone()
    } catch { setError('Password service is temporarily unavailable.') }
    finally { setBusy(false) }
  }

  const field = 'min-h-12 w-full rounded-xl border border-line bg-soft px-4 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'
  return <main className="grid min-h-screen place-items-center bg-page px-5 py-10 font-sans text-ink"><section className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8"><span className={eyebrow}>ACCOUNT SETUP</span><h1 className="text-2xl font-bold">Change your temporary password</h1><p className="mt-2 text-sm leading-6 text-muted">Set a private password before viewing your dashboard or attendance.</p>{error && <p role="alert" className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-100">{error}</p>}<form onSubmit={submit} className="mt-6 space-y-4"><div><label htmlFor="old-password" className="mb-2 block text-sm font-semibold">Temporary password</label><input id="old-password" type="password" required autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} className={field} /></div><div><label htmlFor="new-password" className="mb-2 block text-sm font-semibold">New password</label><input id="new-password" type="password" required minLength={12} autoComplete="new-password" value={next} onChange={event => setNext(event.target.value)} className={field} /></div><div><label htmlFor="confirm-password" className="mb-2 block text-sm font-semibold">Confirm new password</label><input id="confirm-password" type="password" required minLength={12} autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} className={field} /></div><button type="submit" disabled={busy} className={'min-h-12 w-full rounded-xl bg-[#4f4ff1] px-5 text-sm font-bold text-white disabled:opacity-60 ' + focusRing}>{busy ? 'Updating…' : 'Change password'}</button></form><button type="button" onClick={onSignOut} className={'mt-5 text-sm font-semibold text-muted underline ' + focusRing}>Sign out</button></section></main>
}

function App() {
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [user, setUser] = useState<User | null | undefined>(supabase ? undefined : null)
  const [profile, setProfile] = useState<EmployeeProfile | null | undefined>(undefined)
  const [profileError, setProfileError] = useState('')
  const [profileRefresh, setProfileRefresh] = useState(0)
  const [authError, setAuthError] = useState('')
  const [authRetry, setAuthRetry] = useState(0)
  const [rememberedAccount, setRememberedAccount] = useState<RememberedAccount | null>(loadRememberedAccount)
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const [accessNotice, setAccessNotice] = useState('')

  function rememberAccount(verifiedUser: User) {
    const account = accountFromUser(verifiedUser)
    if (!account) return
    setRememberedAccount(account)
    try { localStorage.setItem(REMEMBERED_ACCOUNT_KEY, JSON.stringify(account)) } catch { /* Remembering the account is optional. */ }
  }

  function forgetAccount() {
    setRememberedAccount(null)
    try { localStorage.removeItem(REMEMBERED_ACCOUNT_KEY) } catch { /* Keep the UI usable if storage is unavailable. */ }
  }

  function signedIn(verifiedUser: User) {
    rememberAccount(verifiedUser)
    setAuthError('')
    setAccessNotice('')
    setProfile(undefined)
    setProfileError('')
    setUser(verifiedUser)
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem(THEME_KEY, theme) } catch { /* Theme storage is optional. */ }
  }, [theme])

  useEffect(() => {
    const client = supabase
    if (!client) return
    let mounted = true
    let request = 0
    const verify = async () => {
      const current = ++request
      try {
        const { data, error } = await client.auth.getUser()
        if (!mounted || current !== request) return
        if (error) {
          // Only an invalid/missing session signs out an already verified user.
          if (error.name === 'AuthSessionMissingError' || [400, 401, 403].includes(error.status ?? 0)) {
            setAuthError(''); setProfile(undefined); setUser(null)
          } else setAuthError('Could not verify your session. Check your connection and retry.')
        } else if (data.user) {
          setAuthError('')
          rememberAccount(data.user)
          setUser(data.user)
        } else { setAuthError(''); setProfile(undefined); setUser(null) }
      } catch {
        if (mounted && current === request) setAuthError('Could not reach the sign-in service. Check your connection and retry.')
      }
    }
    const { data: { subscription } } = client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') { request++; setAuthError(''); setProfile(undefined); setUser(null) }
      else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        window.setTimeout(() => { if (mounted) void verify() }, 0)
      }
    })
    void verify()
    const onFocus = () => { void verify() }
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onFocus)
    return () => { mounted = false; subscription.unsubscribe(); window.removeEventListener('focus', onFocus); window.removeEventListener('online', onFocus) }
  }, [authRetry])

  useEffect(() => {
    const client = supabase
    if (!client || !user?.id) return
    let mounted = true
    void Promise.all([client.from('employee_profiles')
      .select('id,full_name,position,phone_number,is_active,must_change_password,terminated_at')
      .eq('id', user.id)
      .maybeSingle(), client.rpc('employee_session_allowed')])
      .then(([{ data, error }, allowed]) => {
        if (!mounted) return
        if (data?.terminated_at || (!error && !allowed.error && allowed.data !== true && data?.is_active !== false)) {
          setAccessNotice(data?.terminated_at ? 'Your employment has been terminated and account access is disabled. Contact your administrator.' : 'Your account access changed. Please sign in again.')
          setProfile(undefined); setUser(null)
          void client.auth.signOut({ scope: 'local' })
          return
        }
        if (allowed.error && data?.is_active) {
          setProfile(null); setProfileError('Could not verify account access. Check your connection and retry.'); return
        }
        setProfile(error ? null : data)
        setProfileError(error ? 'Employee profile could not be loaded.' : '')
      })
      .catch(() => {
        if (!mounted) return
        setProfile(null)
        setProfileError('Employee profile could not be loaded. Check your connection and retry.')
      })
    return () => { mounted = false }
  }, [user?.id, profileRefresh])

  useEffect(() => {
    const client = supabase
    const userId = user?.id
    if (!client || !userId) return
    let mounted = true
    const refresh = () => { if (mounted && !document.hidden) setProfileRefresh(current => current + 1) }
    const onProfileChanged = (payload: { new: Record<string, unknown> }) => {
      if (!mounted) return
      // Access revocation is processed even in a hidden tab. RLS already
      // blocks server actions while the logout message reaches this device.
      if (payload.new.terminated_at || payload.new.is_active === false || payload.new.enabled === false) {
        setAccessNotice('Your account access has been disabled. Contact your administrator.')
        setProfile(undefined); setUser(null)
        void client.auth.signOut({ scope: 'local' })
      } else refresh()
    }
    const channel = client.channel(`employee-profile-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'employee_profiles', filter: `id=eq.${userId}` }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'employee_profiles', filter: `id=eq.${userId}` }, onProfileChanged)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'employee_account_access', filter: `id=eq.${userId}` }, onProfileChanged)
      .subscribe()
    const interval = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      mounted = false
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', refresh)
      void client.removeChannel(channel)
    }
  }, [user?.id])

  async function signOut() {
    if (!supabase || logoutBusy) return
    setLogoutBusy(true)
    setLogoutError('')
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) setLogoutError('Could not sign out. Please try again.')
      else { setProfile(undefined); setUser(null) }
    } catch {
      setLogoutError('Could not sign out. Please try again.')
    }
    setLogoutBusy(false)
  }

  if (user === undefined) return authError
    ? <main className="grid min-h-screen place-items-center bg-page px-5 font-sans text-ink"><div className="w-full max-w-md rounded-2xl border border-line bg-surface p-7 text-center shadow-sm"><h1 className="text-xl font-bold">Session check unavailable</h1><p role="alert" className="mt-3 text-sm text-muted">{authError}</p><button type="button" onClick={() => { setAuthError(''); setAuthRetry(value => value + 1) }} className={'mt-6 min-h-11 rounded-xl bg-[#4f4ff1] px-5 text-sm font-bold text-white ' + focusRing}>Retry</button></div></main>
    : <div role="status" className="grid min-h-screen place-items-center bg-page px-5 font-sans text-sm text-muted">Checking your session…</div>
  if (!user) return <LoginScreen theme={theme} setTheme={setTheme} rememberedAccount={rememberedAccount} onForgetAccount={forgetAccount} onSignedIn={signedIn} notice={accessNotice} />
  if (profile === undefined || (profile && profile.id !== user.id)) return <div role="status" className="grid min-h-screen place-items-center bg-page px-5 font-sans text-sm text-muted">Checking your employee account…</div>
  if (!profile || !profile.is_active) return (
    <div className="grid min-h-screen place-items-center bg-page px-5 py-10 font-sans text-ink">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-7 text-center shadow-sm">
        <span className="mx-auto mb-5 grid size-12 place-items-center rounded-xl bg-soft text-brand"><Icon name="user" size={22} /></span>
        <h1 className="text-2xl font-bold tracking-tight">Employee access pending</h1>
        <p className="mt-3 text-sm leading-6 text-muted">{profileError || (profile ? 'Your account is awaiting administrator activation.' : 'Your employee profile has not been set up yet.')}</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button type="button" onClick={() => setProfileRefresh((value) => value + 1)} className={'min-h-11 rounded-xl bg-[#4f4ff1] px-5 text-sm font-bold text-white ' + focusRing}>Check again</button>
          <button type="button" disabled={logoutBusy} onClick={() => void signOut()} className={'min-h-11 rounded-xl border border-line px-5 text-sm font-bold text-ink disabled:opacity-60 ' + focusRing}>Sign out</button>
        </div>
        {logoutError && <p role="alert" className="mt-4 text-sm text-rose-700 dark:text-rose-300">{logoutError}</p>}
      </div>
    </div>
  )
  if (profile.must_change_password) return <FirstPasswordChange onSignOut={() => void signOut()} onDone={() => setProfileRefresh(value => value + 1)} />
  return <EmployeeDashboard key={user.id} user={user} profile={profile} theme={theme} setTheme={setTheme} onUserUpdated={updated => { rememberAccount(updated); setUser(updated) }} onPhoneUpdated={phone => setProfile(current => current ? { ...current, phone_number: phone } : current)} onLogout={signOut} logoutBusy={logoutBusy} logoutError={logoutError} />
}

export default App
