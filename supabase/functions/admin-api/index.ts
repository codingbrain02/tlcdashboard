import { createClient } from '@supabase/supabase-js'
import { synchronizeEmployeeAccess } from './employee-access.ts'

function defaultKey(json: string | undefined) {
  try {
    const keys: unknown = json ? JSON.parse(json) : null
    return keys && typeof keys === 'object' && 'default' in keys && typeof keys.default === 'string'
      ? keys.default : ''
  }
  catch { return '' }
}

const url = Deno.env.get('SUPABASE_URL') ?? ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  || Deno.env.get('SUPABASE_SECRET_KEY')
  || defaultKey(Deno.env.get('SUPABASE_SECRET_KEYS'))
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  || Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  || defaultKey(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'))
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
}

function reply(status: number, message: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ message, ...extra }), { status, headers })
}

function text(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().slice(0, limit + 1) : ''
}

function searchWords(value: unknown, limit: number) {
  if (typeof value !== 'string') return []
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized.length > limit) return null
  const words = normalized ? normalized.split(' ') : []
  return words.length <= 8 ? words : null
}

function likeContains(value: string) {
  return `%${value.replace(/[\\%_*]/g, '\\$&')}%`
}

function oneTimePassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function validEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

async function authenticatedUser(request: Request) {
  const match = /^Bearer (.+)$/i.exec(request.headers.get('Authorization') ?? '')
  if (!match) return null
  const { data, error } = await admin.auth.getUser(match[1])
  return error ? null : data.user
}

const employeeColumns = 'id,full_name,email,position,phone_number,is_active,created_at,terminated_at,termination_reason,termination_details,employment_start_date,revision,access_generation,auth_sync_pending'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function commandFailure(error: { code?: string; message?: string }) {
  if (error.code === '42501') return reply(403, 'You do not have permission for this action.')
  if (error.code === '40001') return reply(409, 'This record changed. Refresh and review your changes again.')
  if (error.code === 'P0002') return reply(404, 'Employee or attendance record not found.')
  if (error.code === '22023') return reply(400, error.message ?? 'Check the supplied details.')
  if (error.code?.startsWith('22') || error.code?.startsWith('23')) return reply(400, 'Check the supplied details, dates and shift status.')
  return reply(503, 'Could not complete the action. Refresh and try again.')
}

// The database blocks account actions immediately. Auth bans are synchronized
// through the supported Auth API. Re-read the generation to handle two admins
// changing status concurrently; never apply an older ban over a newer rehire.
async function syncEmployeeAccess(employeeId: string) {
  return await synchronizeEmployeeAccess({
    async read() {
      const latest = await admin.from('admin_employee_directory')
        .select('access_generation,auth_sync_pending,terminated_at,is_active').eq('id', employeeId).single()
      if (latest.error) throw latest.error
      return { generation: latest.data.access_generation, pending: latest.data.auth_sync_pending,
        blocked: Boolean(latest.data.terminated_at) || !latest.data.is_active }
    },
    async setBlocked(blocked) {
      const changed = await admin.auth.admin.updateUserById(employeeId, { ban_duration: blocked ? '876000h' : 'none' })
      if (changed.error) throw changed.error
    },
    async markSynced(generation) {
      const result = await admin.from('employee_profiles').update({ auth_sync_pending: false })
        .eq('id', employeeId).eq('access_generation', generation).select('id')
      if (result.error) throw result.error
      return Boolean(result.data?.length)
    },
    async markPending() {
      const result = await admin.from('employee_profiles').update({ auth_sync_pending: true }).eq('id', employeeId)
      if (result.error) throw result.error
    },
  })
}

async function changeManagedPassword(accountId: string, password: string, requestId: string) {
  const marked = await admin.auth.admin.updateUserById(accountId, {
    app_metadata: { tlc_password_change_request: requestId },
  })
  if (!marked.error) {
    const changed = await admin.auth.admin.updateUserById(accountId, { password })
    if (!changed.error) return true
    await admin.auth.admin.updateUserById(accountId, { app_metadata: { tlc_password_change_request: null } })
  }
  await admin.rpc('cancel_password_request', { request_id: requestId })
  return false
}

async function changeOwnPassword(accountId: string, password: string, currentPassword: string, requestId: string, authorization: string) {
  let succeeded = false
  try {
    const marked = await admin.auth.admin.updateUserById(accountId, {
      app_metadata: { tlc_password_change_request: requestId },
    })
    if (marked.error) return false
    // Using the caller's existing JWT preserves that Auth session. The admin
    // updateUserById password endpoint intentionally revokes every session.
    const changed = await fetch(`${url}/auth/v1/user`, {
      method: 'PUT', headers: { apikey: anonKey, Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, current_password: currentPassword }),
    })
    succeeded = changed.ok
    await changed.body?.cancel().catch(() => {})
    return succeeded
  } finally {
    if (!succeeded) {
      await admin.auth.admin.updateUserById(accountId, { app_metadata: { tlc_password_change_request: null } })
      await admin.rpc('cancel_password_request', { request_id: requestId })
    }
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return reply(405, 'Method not allowed.')
  if (!url || !serviceKey || !anonKey) return reply(503, 'Account service is unavailable.')

  try {
    const user = await authenticatedUser(request)
    if (!user) return reply(401, 'Sign in required.')
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: request.headers.get('Authorization')! } },
    })
    const body = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, 'Invalid request.')

    if (body.action === 'change-password') {
      const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''
      if (!currentPassword || currentPassword.length > 128 || newPassword.length < 12 || newPassword.length > 128 || newPassword === currentPassword) {
        return reply(400, 'Choose a different password of at least 12 characters.')
      }
      if (!user.email) return reply(403, 'Account email is unavailable.')
      const verifier = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
      const proof = await verifier.auth.signInWithPassword({ email: user.email, password: currentPassword })
      if (proof.error || proof.data.user?.id !== user.id) return reply(401, 'Current password is incorrect.')

      const { data: adminAccount, error: adminError } = await admin.from('admin_users')
        .select('id,must_change_password').eq('id', user.id).maybeSingle()
      if (proof.data.session) await verifier.auth.signOut({ scope: 'local' })
      if (adminError) return reply(503, 'Could not verify account access.')
      if (adminAccount) {
        const allowed = await userClient.rpc('admin_session_allowed')
        if (allowed.error || allowed.data !== true) return reply(403, 'Please sign in again.')
      }
      if (!adminAccount) {
        const allowed = await userClient.rpc('employee_session_allowed')
        if (allowed.error || allowed.data !== true) return reply(403, 'Employee access required.')
      }
      const { data: account, error: lookupError } = adminAccount
        ? { data: adminAccount, error: null }
        : await admin.from('employee_profiles').select('id,must_change_password').eq('id', user.id).maybeSingle()
      if (lookupError || !account) return reply(403, 'Account access required.')

      const authorization = await admin.rpc('request_own_password_change', { account_id: user.id })
      if (authorization.error) return commandFailure(authorization.error)
      const updated = await changeOwnPassword(user.id, newPassword, currentPassword, authorization.data, request.headers.get('Authorization')!)
      if (!updated) return reply(503, 'Could not update password. Please retry.')
      return reply(200, 'Password changed. You are still signed in on this device.')
    }

    if (body.action === 'change-email') {
      const nextEmail = text(body.email, 254).toLowerCase()
      const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
      if (!validEmail(nextEmail) || !currentPassword || currentPassword.length > 128) {
        return reply(400, 'Enter a valid email and your current password.')
      }
      if (!user.email) return reply(403, 'Account email is unavailable.')

      const allowed = await userClient.rpc('employee_session_allowed')
      if (allowed.error || allowed.data !== true) return reply(403, 'Employee access required.')

      const [employee, adminAccount] = await Promise.all([
        admin.from('employee_profiles').select('id,is_active,must_change_password').eq('id', user.id).maybeSingle(),
        admin.from('admin_users').select('id').eq('id', user.id).maybeSingle(),
      ])
      if (employee.error || adminAccount.error || adminAccount.data || !employee.data?.is_active || employee.data.must_change_password) {
        return reply(403, 'Employee access required.')
      }
      if (nextEmail === user.email.toLowerCase()) return reply(200, 'Email is unchanged.', { email: user.email })

      const verifier = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
      const proof = await verifier.auth.signInWithPassword({ email: user.email, password: currentPassword })
      if (proof.error || proof.data.user?.id !== user.id) return reply(401, 'Current password is incorrect.')

      const changed = await admin.auth.admin.updateUserById(user.id, { email: nextEmail, email_confirm: true })
      if (changed.error || changed.data.user?.email?.toLowerCase() !== nextEmail) {
        return reply(409, 'Could not change email. Check whether the address is available.')
      }
      return reply(200, 'Email changed.', { email: changed.data.user.email })
    }

    const { data: operator, error: roleError } = await admin.from('admin_users')
      .select('role,must_change_password').eq('id', user.id).maybeSingle()
    if (roleError || !operator || operator.must_change_password) return reply(403, 'Administrator access required.')
    const adminSession = await userClient.rpc('admin_session_allowed')
    if (adminSession.error || adminSession.data !== true) return reply(403, 'Please sign in again.')

    if (body.action === 'set-password') {
      if (operator.role !== 'super_admin') return reply(403, 'Super administrator access required.')
      const targetId = text(body.targetId, 36)
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''
      if (!uuidPattern.test(targetId) || targetId === user.id || newPassword.length < 12 || newPassword.length > 128) {
        return reply(400, 'Select an account and enter a password of 12–128 characters.')
      }
      const authorization = await admin.rpc('request_account_password_set', { actor_id: user.id, target_id: targetId })
      if (authorization.error) return commandFailure(authorization.error)
      const updated = await changeManagedPassword(targetId, newPassword, authorization.data)
      if (!updated) return reply(503, 'Could not change the password. Please retry.')
      return reply(200, 'Password changed. The account can sign in with its new password.')
    }

    const runCommand = (employeeId: string, command: string, details: Record<string, unknown>, revision: number) =>
      admin.rpc('admin_employee_command', {
        actor_id: user.id, employee_id: employeeId, command, details, expected_revision: revision,
      })

    if (['terminate', 'reverse-termination', 'rehire', 'sync-employee-access'].includes(body.action)) {
      const employeeId = text(body.employeeId, 36)
      if (!uuidPattern.test(employeeId) || body.confirmed !== true) return reply(400, 'Review and confirm this employee action.')
      if (body.action !== 'sync-employee-access') {
        if (!Number.isSafeInteger(body.revision) || body.revision < 0) return reply(400, 'Refresh this employee before continuing.')
        const result = await runCommand(employeeId, body.action, {
          category: text(body.category, 80), reason: text(body.reason, 1500), startDate: text(body.startDate, 10) || null,
        }, body.revision)
        if (result.error) return commandFailure(result.error)
      }
      const synced = await syncEmployeeAccess(employeeId)
      const profile = await admin.from('admin_employee_directory').select(employeeColumns).eq('id', employeeId).single()
      if (profile.error) return reply(503, 'Action processed. Refresh to see the current account status.')
      return reply(200, synced ? 'Employee account updated.' : 'Account status saved. Sign-in protection still needs synchronization; please retry.', {
        employee: profile.data, syncPending: !synced,
      })
    }

    if (body.action === 'list-activity') {
      if (operator.role !== 'super_admin') return reply(403, 'Super administrator access required.')
      const page = Number.isInteger(body.page) && body.page >= 0 && body.page <= 1000 ? body.page : 0
      const result = await admin.from('admin_activity_log')
        .select('id,actor_name,employee_id,employee_name,action,reason,before_data,after_data,occurred_at')
        .order('occurred_at', { ascending: false }).order('id', { ascending: true }).range(page * 20, page * 20 + 20)
      if (result.error) return reply(503, 'Could not load activity logs.')
      return reply(200, 'Activity loaded.', { events: result.data.slice(0, 20), hasMore: result.data.length > 20 })
    }

    if (body.action === 'update-attendance') {
      if (operator.role !== 'super_admin') return reply(403, 'Super administrator access required.')
      if (body.confirmed !== true || !uuidPattern.test(body.employeeId ?? '') || !Number.isSafeInteger(body.revision)) return reply(400, 'Review and confirm the attendance correction.')
      const result = await runCommand(body.employeeId, 'update-attendance', {
        shiftId: body.shiftId, clockIn: body.clockIn, clockOut: body.clockOut || null,
        endReason: body.endReason, expectedClockIn: body.expectedClockIn,
        expectedClockOut: body.expectedClockOut, expectedEndReason: body.expectedEndReason,
        reason: text(body.reason, 1500),
      }, body.revision)
      if (result.error) return commandFailure(result.error)
      return reply(200, 'Attendance corrected.')
    }

    if (body.action === 'update-employee-email') {
      if (operator.role !== 'super_admin') return reply(403, 'Super administrator access required.')
      const employeeId = text(body.employeeId, 36)
      const email = text(body.email, 254).toLowerCase()
      if (!uuidPattern.test(employeeId) || !validEmail(email) || body.confirmed !== true || !Number.isSafeInteger(body.revision)) return reply(400, 'Review and confirm the email change.')
      const recorded = await runCommand(employeeId, 'email-change-requested', { email }, body.revision)
      if (recorded.error) return commandFailure(recorded.error)
      const changed = await admin.auth.admin.updateUserById(employeeId, { email, email_confirm: true })
      const outcome = await runCommand(employeeId, changed.error ? 'email-change-failed' : 'email-changed', {
        email, requestId: recorded.data.eventId,
      }, body.revision)
      if (changed.error) return reply(409, 'Could not change email. Check whether the address is already used.')
      if (outcome.error) return reply(503, 'Email changed; the recorded request needs a log follow-up. Refresh before retrying.')
      return reply(200, 'Employee email updated.')
    }

    if (body.action === 'list-employees') {
      if (operator.role !== 'super_admin' && operator.role !== 'admin') return reply(403, 'Administrator access required.')
      const page = Number.isInteger(body.page) && body.page >= 0 && body.page <= 1000 ? body.page : 0
      const nameWords = searchWords(body.name, 80)
      const positionWords = searchWords(body.position, 120)
      const status = body.status ?? 'all'
      const sort = body.sort ?? 'newest'
      if (!nameWords || !positionWords || !['all', 'active', 'inactive', 'terminated'].includes(status)
        || !['newest', 'name-asc', 'name-desc', 'position-asc', 'position-desc'].includes(sort)) {
        return reply(400, 'Invalid employee filters.')
      }
      const size = 20
      let query = admin.from('admin_employee_directory')
        .select(employeeColumns)
      for (const word of nameWords) query = query.ilike('full_name', likeContains(word))
      for (const word of positionWords) query = query.ilike('position', likeContains(word))
      if (status === 'terminated') query = query.not('terminated_at', 'is', null)
      else if (status !== 'all') query = query.eq('is_active', status === 'active').is('terminated_at', null)
      if (sort === 'name-asc' || sort === 'name-desc') {
        query = query.order('full_name', { ascending: sort === 'name-asc' })
      } else if (sort === 'position-asc' || sort === 'position-desc') {
        query = query.order('position', { ascending: sort === 'position-asc', nullsFirst: false })
          .order('full_name', { ascending: true })
      } else {
        query = query.order('created_at', { ascending: false })
      }
      const listed = await query.order('id', { ascending: true }).range(page * size, page * size + size)
      if (listed.error) return reply(503, 'Could not load employees.')
      const employees = (listed.data ?? []).slice(0, size).map(profile => ({
        ...profile, email: profile.email ?? '',
      }))
      return reply(200, 'Employees loaded.', { employees, hasMore: (listed.data?.length ?? 0) > size })
    }

    if (body.action === 'list-attendance') {
      if (operator.role !== 'super_admin' && operator.role !== 'admin') return reply(403, 'Administrator access required.')
      const page = Number.isInteger(body.page) && body.page >= 0 && body.page <= 1000 ? body.page : 0
      const size = 20
      const listed = await admin.from('admin_attendance_directory')
        .select('id,user_id,full_name,clock_in,clock_out,end_reason')
        .order('clock_in', { ascending: false }).order('id', { ascending: true })
        .range(page * size, page * size + size)
      if (listed.error) return reply(503, 'Could not load attendance.')
      return reply(200, 'Attendance loaded.', {
        shifts: (listed.data ?? []).slice(0, size),
        hasMore: (listed.data?.length ?? 0) > size,
      })
    }

    if (body.action === 'update-employee') {
      if (operator.role !== 'super_admin') return reply(403, 'Super administrator access required.')
      const employeeId = typeof body.employeeId === 'string' ? body.employeeId.trim() : ''
      const fullName = text(body.fullName, 120)
      const position = text(body.position, 120)
      const phoneNumber = text(body.phoneNumber, 40)
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employeeId)
        || !fullName || fullName.length > 120 || !position || position.length > 120
        || !/^\+[1-9]\d{6,14}$/.test(phoneNumber)) {
        return reply(400, 'Check the employee details and try again.')
      }

      if (body.confirmed !== true || !Number.isSafeInteger(body.revision)) return reply(400, 'Review and confirm the employee changes.')
      const updated = await runCommand(employeeId, 'update-profile', {
        fullName, position, phoneNumber, registeredAt: body.registeredAt || null, startDate: body.startDate || null,
      }, body.revision)
      if (updated.error) return commandFailure(updated.error)
      return reply(200, 'Employee details updated.', { employee: updated.data.employee })
    }

    if (body.action === 'create-employee') {
      const fullName = text(body.fullName, 120)
      const email = text(body.email, 254).toLowerCase()
      const position = text(body.position, 120)
      const phoneNumber = text(body.phoneNumber, 40)
      if (!fullName || fullName.length > 120 || !validEmail(email) || !position || position.length > 120 || !/^\+[1-9]\d{6,14}$/.test(phoneNumber)) {
        return reply(400, 'Check the employee details and try again.')
      }
      const temporaryPassword = oneTimePassword()
      const created = await admin.auth.admin.createUser({
        email, password: temporaryPassword, email_confirm: true,
        user_metadata: { full_name: fullName, phone: phoneNumber },
      })
      if (created.error || !created.data.user) return reply(409, 'Could not create the account. Check whether the email is already used.')
      const employeeId = created.data.user.id
      const profile = await runCommand(employeeId, 'create-employee', { fullName, position, phoneNumber }, 0)
      if (profile.error || !profile.data) {
        await admin.auth.admin.deleteUser(employeeId)
        return reply(503, 'Could not finish account setup. Please retry.')
      }
      return reply(201, 'Employee created.', { email, temporaryPassword })
    }

    if (body.action === 'create-admin') {
      if (operator.role !== 'super_admin') return reply(403, 'Super administrator access required.')
      const username = text(body.username, 32).toLowerCase()
      if (!/^[a-z][a-z0-9_]{2,31}$/.test(username)) {
        return reply(400, 'Username must be 3–32 lowercase letters, numbers, or underscores, starting with a letter.')
      }
      const email = `tlc-admin-${username}@example.com`
      const temporaryPassword = oneTimePassword()
      const created = await admin.auth.admin.createUser({
        email, password: temporaryPassword, email_confirm: true,
        user_metadata: { admin_username: username },
      })
      if (created.error || !created.data.user) return reply(409, 'This username is unavailable.')
      const adminId = created.data.user.id
      const inserted = await admin.from('admin_users').insert({
        id: adminId, username, role: 'admin', must_change_password: true,
      })
      if (inserted.error) {
        await admin.auth.admin.deleteUser(adminId)
        return reply(409, 'This username is unavailable.')
      }
      return reply(201, 'Administrator created.', { username, temporaryPassword })
    }

    return reply(400, 'Unknown action.')
  } catch {
    return reply(500, 'Account service encountered an error.')
  }
})
