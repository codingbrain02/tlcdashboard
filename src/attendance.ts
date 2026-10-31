import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

export type Shift = { id: string; clockIn: string; clockOut: string | null; endReason: 'clock_out' | 'terminated' }
type ShiftRow = { id: string; clock_in: string; clock_out: string | null; end_reason: 'clock_out' | 'terminated' }
type ClockAnchor = { serverMs: number; monotonicMs: number }

function mapShift(row: ShiftRow): Shift {
  return { id: row.id, clockIn: row.clock_in, clockOut: row.clock_out, endReason: row.end_reason }
}

function weekStart(serverMs: number): string {
  const monday = new Date(serverMs)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return monday.toISOString()
}

export function useAttendance(userId: string) {
  const client = supabase!
  const [dashboardShifts, setDashboardShifts] = useState<Shift[]>([])
  const [recentShifts, setRecentShifts] = useState<Shift[]>([])
  const [anchor, setAnchor] = useState<ClockAnchor | null>(null)
  const [now, setNow] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const refreshId = useRef(0)

  const refresh = useCallback(async () => {
    const current = ++refreshId.current
    try {
      const started = performance.now()
      const timeResult = await client.rpc('attendance_server_time')
      const finished = performance.now()
      if (current !== refreshId.current) return
      const serverMs = typeof timeResult.data === 'string' ? Date.parse(timeResult.data) : NaN
      if (timeResult.error || !Number.isFinite(serverMs)) {
        setError('Could not synchronize with the attendance server. Please retry.')
        return
      }

      const nextAnchor = { serverMs, monotonicMs: (started + finished) / 2 }
      const monday = weekStart(serverMs)
      const weekResult = await client.from('attendance').select('id,clock_in,clock_out,end_reason')
        .eq('user_id', userId)
        .or(`clock_in.gte.${monday},clock_out.gte.${monday},clock_out.is.null`)
        .order('clock_in', { ascending: false })
      if (current !== refreshId.current) return
      if (weekResult.error) {
        setError('Could not load attendance records. Please retry.')
        return
      }
      const weekShifts = (weekResult.data ?? []).map(mapShift)
      let recentShifts = weekShifts.slice(0, 4)
      // Most weeks already contain the four recent records; only request older ones when needed.
      if (recentShifts.length < 4) {
        const recentResult = await client.from('attendance').select('id,clock_in,clock_out,end_reason')
          .eq('user_id', userId)
          .order('clock_in', { ascending: false })
          .limit(4)
        if (current !== refreshId.current) return
        if (recentResult.error) {
          setError('Could not load attendance records. Please retry.')
          return
        }
        recentShifts = (recentResult.data ?? []).map(mapShift)
      }
      setAnchor(nextAnchor)
      setNow(serverMs)
      setDashboardShifts(weekShifts)
      setRecentShifts(recentShifts)
      setError('')
    } catch {
      if (current === refreshId.current) setError('Could not reach the attendance server. Please retry.')
    } finally {
      if (current === refreshId.current) setLoading(false)
    }
  }, [client, userId])

  useEffect(() => {
    let disposed = false
    let pendingHistoryRefresh = false
    const refreshToken = refreshId
    const sync = () => {
      if (disposed || document.hidden) return
      if (pendingHistoryRefresh) {
        pendingHistoryRefresh = false
        setVersion(previous => previous + 1)
      }
      void refresh()
    }
    const syncFromChange = () => { if (!disposed) { pendingHistoryRefresh = true; sync() } }
    queueMicrotask(sync)
    const channel = client.channel(`employee-attendance-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance', filter: `user_id=eq.${userId}` }, syncFromChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'attendance', filter: `user_id=eq.${userId}` }, syncFromChange)
      .subscribe()
    const interval = window.setInterval(sync, 120_000)
    window.addEventListener('focus', sync)
    window.addEventListener('online', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      disposed = true
      refreshToken.current++
      window.clearInterval(interval)
      window.removeEventListener('focus', sync)
      window.removeEventListener('online', sync)
      document.removeEventListener('visibilitychange', sync)
      void client.removeChannel(channel)
    }
  }, [client, refresh, userId])

  useEffect(() => {
    if (!anchor) return
    const tick = () => setNow(anchor.serverMs + performance.now() - anchor.monotonicMs)
    tick()
    const interval = window.setInterval(tick, 1000)
    return () => window.clearInterval(interval)
  }, [anchor])

  const active = dashboardShifts.find((shift) => shift.clockOut === null) ?? null

  async function toggleShift() {
    if (busy || now === null) return
    setBusy(true)
    setError('')
    try {
      const { error: actionError } = active
        ? await client.rpc('clock_out_shift_if_current', { expected_shift_id: active.id })
        : await client.rpc('clock_in_shift')
      await refresh()
      if (actionError) setError(active
        ? 'Clock-out did not complete. Your current status has been refreshed.'
        : 'Clock-in did not complete. Your current status has been refreshed.')
      else setVersion((previous) => previous + 1)
    } catch {
      setError('Attendance action failed. Please check your connection and retry.')
    } finally {
      setBusy(false)
    }
  }

  return { dashboardShifts, recentShifts, active, now, loading, busy, error, refresh, toggleShift, version }
}

export function useAttendanceHistory(userId: string, version: number, enabled: boolean) {
  const client = supabase!
  const pageSize = 50
  const [shifts, setShifts] = useState<Shift[]>([])
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const loadingRef = useRef(false)
  const generationRef = useRef(0)

  const fetchPage = useCallback(async (start: number) => {
    if (loadingRef.current) return
    const generation = generationRef.current
    loadingRef.current = true
    setLoading(true)
    try {
      const { data, error: queryError } = await client.from('attendance')
        .select('id,clock_in,clock_out,end_reason')
        .eq('user_id', userId)
        .order('clock_in', { ascending: false })
        .range(start, start + pageSize - 1)
      if (generation !== generationRef.current) return
      if (queryError) setError('Could not load attendance history. Please retry.')
      else {
        const page = (data ?? []).map(mapShift)
        setShifts((current) => start === 0 ? page : [...current, ...page])
        setHasMore(page.length === pageSize)
        setError('')
      }
    } catch {
      if (generation === generationRef.current) setError('Could not reach attendance history. Please retry.')
    } finally {
      if (generation === generationRef.current) {
        setLoading(false)
        loadingRef.current = false
      }
    }
  }, [client, userId])

  useEffect(() => {
    const generation = ++generationRef.current
    loadingRef.current = false
    queueMicrotask(() => {
      if (generation !== generationRef.current) return
      setLoading(false)
      setError('')
      setShifts([])
      setHasMore(true)
      if (enabled) void fetchPage(0)
    })
  }, [enabled, fetchPage, version])

  const loadMore = () => { if (hasMore && !loading) void fetchPage(shifts.length) }
  const retry = () => { if (!loading) void fetchPage(shifts.length) }
  return { shifts, hasMore, loading, error, loadMore, retry }
}
