import { createClient } from '@supabase/supabase-js'

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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return reply(405, 'Method not allowed.')
  if (!url || !serviceKey || !anonKey) return reply(503, 'Account service is unavailable.')

  try {
    const user = await authenticatedUser(request)
    if (!user) return reply(401, 'Sign in required.')
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

      const { data: adminAccount } = await admin.from('admin_users')
        .select('id,must_change_password').eq('id', user.id).maybeSingle()
      const table = adminAccount ? 'admin_users' : 'employee_profiles'
      const { data: account, error: lookupError } = adminAccount
        ? { data: adminAccount, error: null }
        : await admin.from('employee_profiles').select('id,must_change_password').eq('id', user.id).maybeSingle()
      if (lookupError || !account?.must_change_password) return reply(403, 'Password change is not required for this account.')

      const updated = await admin.auth.admin.updateUserById(user.id, { password: newPassword })
      if (updated.error) return reply(503, 'Could not update password. Please retry.')
      const cleared = await admin.from(table).update({ must_change_password: false }).eq('id', user.id)
      if (cleared.error) return reply(503, 'Password changed, but account setup needs support. Contact your administrator.')
      return reply(200, 'Password changed. Please sign in again.')
    }

    if (body.action === 'change-email') {
      const nextEmail = text(body.email, 254).toLowerCase()
      const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
      if (!validEmail(nextEmail) || !currentPassword || currentPassword.length > 128) {
        return reply(400, 'Enter a valid email and your current password.')
      }
      if (!user.email) return reply(403, 'Account email is unavailable.')

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

    if (body.action === 'list-employees') {
      if (operator.role !== 'super_admin') return reply(403, 'Super administrator access required.')
      const page = Number.isInteger(body.page) && body.page >= 0 && body.page <= 100000 ? body.page : 0
      const size = 20
      const listed = await admin.from('employee_profiles')
        .select('id,full_name,email,position,phone_number,is_active,created_at', { count: 'exact' })
        .order('created_at', { ascending: false }).range(page * size, page * size + size - 1)
      if (listed.error) return reply(503, 'Could not load employees.')
      const profiles = listed.data ?? []
      const adminIds = new Set<string>()
      if (profiles.length) {
        const admins = await admin.from('admin_users').select('id').in('id', profiles.map(profile => profile.id))
        if (admins.error) return reply(503, 'Could not load employees.')
        for (const account of admins.data ?? []) adminIds.add(account.id)
      }
      const employees = profiles.filter(profile => !adminIds.has(profile.id)).map(profile => ({
        ...profile, email: profile.email ?? '',
      }))
      return reply(200, 'Employees loaded.', { employees, hasMore: (listed.count ?? 0) > (page + 1) * size })
    }

    if (body.action === 'list-attendance') {
      if (operator.role !== 'super_admin') return reply(403, 'Super administrator access required.')
      const page = Number.isInteger(body.page) && body.page >= 0 && body.page <= 100000 ? body.page : 0
      const size = 20
      const listed = await admin.from('attendance')
        .select('id,user_id,clock_in,clock_out', { count: 'exact' })
        .order('clock_in', { ascending: false }).range(page * size, page * size + size - 1)
      if (listed.error) return reply(503, 'Could not load attendance.')
      const shifts = listed.data ?? []
      const names = new Map<string, string>()
      if (shifts.length) {
        const profiles = await admin.from('employee_profiles').select('id,full_name')
          .in('id', [...new Set(shifts.map(shift => shift.user_id))])
        if (profiles.error) return reply(503, 'Could not load attendance.')
        for (const profile of profiles.data ?? []) names.set(profile.id, profile.full_name)
      }
      return reply(200, 'Attendance loaded.', {
        shifts: shifts.map(shift => ({ ...shift, full_name: names.get(shift.user_id) ?? 'Employee' })),
        hasMore: (listed.count ?? 0) > (page + 1) * size,
      })
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
      const profile = await admin.from('employee_profiles').update({
        full_name: fullName, position, phone_number: phoneNumber,
        is_active: true, must_change_password: true,
      }).eq('id', employeeId).select('id').single()
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
