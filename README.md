# Tech Live Connect — Employee Workspace & Shared Backend

Tech Live Connect (TLC) is a private employee-attendance system. Employees clock in and out, review their records, and manage their contact information. A separate administration app manages employee accounts, employment status, and attendance oversight.

This repository contains the employee website and the shared Supabase backend. The administration website has its own Git repository. Both websites use the same Supabase project; a second database is not required.

## Projects and ownership

| Component | Production website | Source repository |
| --- | --- | --- |
| Employee workspace and shared backend | [tlcdashboard.vercel.app](https://tlcdashboard.vercel.app/) | [codingbrain02/tlcdashboard](https://github.com/codingbrain02/tlcdashboard) |
| Administration workspace | [tlcdashboard-admin.vercel.app](https://tlcdashboard-admin.vercel.app/) | [codingbrain02/tlcdashboard-admin](https://github.com/codingbrain02/tlcdashboard-admin) |

Permanent local folders:

```text
C:\Users\DELL\Documents\Personal Docs\tlcdashboard
└── tlcdashboard-admin    # Independent Git repository, ignored by the parent
```

Shared Supabase project: `fxldcjqqlhnbdrpapadu`. The configured project owner and application Super Administrator use `codingbrain02@gmail.com`, but Supabase CLI authentication and application sign-in are separate sessions. A Supabase access token is never an application password.

See the [administration guide](https://github.com/codingbrain02/tlcdashboard-admin/blob/main/README.md) for detailed admin workflows.

## Architecture

| Layer | Responsibility |
| --- | --- |
| Employee React app | Sign-in, time clock, personal attendance, contact settings, emoji selection |
| Administration React app | Team overview, directory, account creation, employment actions, authorized corrections |
| Supabase Auth | Credentials, verified identities, persistent sessions, password updates, sign-in bans |
| Postgres and Realtime | Attendance timestamps, access policies, transactions, activity records, change notifications |
| `admin-api` Edge Function | Authorizes the caller before performing privileged operations with server-only credentials |

Both websites use React, TypeScript, Vite, and Tailwind CSS. Permitted reads and employee RPCs go directly to Supabase; privileged account operations go through `admin-api`. Database policies, session checks, and backend role checks enforce access. Hidden buttons are not the security boundary.

## Employee workflow

1. An administrator creates an account with a full name, unused email, position, and required phone number.
2. The server generates a temporary password, shown once in the admin app for private sharing. No invitation email is sent.
3. The employee signs in and must replace the temporary password before accessing attendance.
4. Dashboard displays the active shift, today's and this week's elapsed hours, and recent attendance. My profile provides employee information, contact settings, and older attendance records.
5. Signing out or closing the website does not end a shift. An explicit clock-out, termination, or authorized attendance correction changes the stored shift.

The logo refreshes data without reloading the document. Sidebar navigation includes appearance settings and a centered Change my password modal. Both themes, narrow screens, keyboard focus, and reduced motion are supported.

### Attendance and time calculations

- `clock_in_shift()` creates an attendance row with a server timestamp. A unique partial index enforces one open shift per employee.
- `clock_out_shift_if_current(expected_shift_id)` updates only that specific open shift. A stale tab cannot close a newer one.
- An open shift has `clock_out = null`; clock-out updates the same row, and a subsequent clock-in creates a new row.
- The browser synchronizes through `attendance_server_time()` and uses monotonic elapsed time between synchronizations. The device's wall clock does not set attendance timestamps.
- No browser timer needs to run in the background. Elapsed time is calculated from stored timestamps when the page is displayed again.
- Displayed times use the viewing device's time zone. Daily and Monday-based weekly totals count each shift's overlap with that local period. Older history is paginated.

Internet access is required to save clock actions. There is no offline punch queue. After a failed or uncertain request, refresh the current status before retrying rather than assuming the action saved.

### Profile and contact settings

Employees can change their own email, phone number, and emoji, but not their name, position, employee ID, or attendance timestamps.

- Phone input supplies a country selector, calling code, and international formatting. Basic international-number syntax is required; there is no SMS verification or proof of ownership.
- Email changes require the current password and apply immediately through `admin-api`, without confirmation links. An Auth trigger synchronizes the email to the employee profile used by the directory.
- The employee UUID remains the stable identifier through email changes, termination reversal, and rehire.
- Employees choose from 48 preset emojis, saved in Supabase and displayed across the employee workspace, remembered login shortcut, and admin employee records. Personal photos, uploads, image URLs, and arbitrary avatar text are not supported. Admin/Super Admin accounts have no personal avatars.

Instant email changes are intentional, not inbox verification. A typo or someone else's address can disrupt sign-in/recovery or redirect future mail. Employees should check the address carefully, and operators need a private recovery procedure.

## Sign-in, sessions, and passwords

Auth sessions persist in browser storage and refresh automatically. Tab focus rechecks access without deliberately replacing an already verified workspace with a full-page loading screen. This does not guarantee an unlimited session: storage clearing, revocation, invalid sessions, or Auth policy changes can require sign-in again.

After explicit employee sign-out, the login screen can remember the last account's name, email, ID, and emoji as a shortcut. The password is always required. Remove from this device clears that shortcut, not the account.

| Password operation | Current device | Other sessions | Open shift |
| --- | --- | --- | --- |
| Any role changes their own password | Stays signed in | Revoked | Continues |
| First-sign-in password setup | Stays signed in and opens the workspace | Revoked | Unchanged |
| Super Admin sets another Admin's or employee's password | Target must sign in again | All target sessions revoked | Continues |

Self-service requires the current password, a different new password of 12–128 characters, and matching confirmation. Setting another account's password as Super Admin applies directly: no confirmation dialog, Super Admin password prompt, or forced temporary-password step. Share the new password privately. Newly created accounts still require temporary-password onboarding.

Database triggers and server-only password-operation records coordinate Auth writes, setup flags, audit entries, and session cutoffs. Passwords are not retrievable or recorded in activity logs. Changing a password does not reactivate terminated accounts.

## Administration and employment status

| Capability | Employee | Admin | Super Admin |
| --- | --- | --- | --- |
| View attendance | Own records | All employees | All employees |
| Change own password | Yes | Yes | Yes |
| Change employee contact details | Own email/phone | No | Yes |
| Create employee accounts | No | Yes | Yes |
| Terminate, reverse termination, rehire | No | With confirmation | With confirmation |
| Correct employee details, dates, or attendance | No | No | With review/confirmation |
| Set another account's password | No | No | Admin and employee accounts |
| View/create other admins; view activity log | No | No | Yes |

Regular admins sign in with unique usernames; the Super Admin uses the configured owner email. Regular admins cannot read other administrator profiles/attendance or the owner's personal Auth details. The owner is represented as Super Administrator where applicable.

Employment actions preserve history:

- Termination requires a reason category; Other also requires details. It closes a running shift as Terminated, immediately blocks database access, and sends a minimal access-status notification to sign the employee out. Auth sign-in bans are synchronized through the supported Auth API.
- Reversal requires an explanation and restores the same account without changing its employment start date. There is no automatic reversal deadline; company policy must define any procedural limit.
- Rehire restores the same account with a new employment start date and retains prior attendance.
- All three actions require confirmation. Restored employees must sign in again; old sessions and stopped shifts never resume.
- If Auth ban/unban synchronization fails, the admin profile exposes a retry. Database restrictions remain enforced. Offline browsers receive live changes after reconnecting, and revocation cannot erase already-downloaded information.

The Super Admin's append-only activity log covers managed employee actions and administrative password changes, including verified actor, target, server time, reason, and relevant before/after values. It is not a complete login/traffic log and does not reconstruct events from before logging was enabled.

## Live updates and concurrent users

Attendance/profile changes use Supabase Realtime, with focus, reconnect, and periodic refresh recovery. Updates require connectivity; no fixed millisecond delivery time is guaranteed.

The admin overview displays organization-wide counts, independent of attendance pagination:

| Card | Meaning |
| --- | --- |
| Active employees | Enabled, non-terminated employees; excludes administrators |
| On duty | Active employees with an open shift, even when signed out or the website is closed |
| Off duty | Remaining active employees without an open shift |

`admin_team_availability()` computes all three in one database snapshot. Only the service role can execute it; the authorized `admin-api` response supplies totals to the UI. Missing/invalid totals display unavailable values and retry controls, not fake zeros.

Each employee's writes are scoped to their own ID. Transactions, the single-open-shift constraint, and exact-shift clock-out protect concurrent actions. Admin edits use revisions to reject stale confirmations and reject overlapping attendance corrections. Access generations prevent an older termination from silently overwriting a newer restoration. Pagination, targeted subscriptions, indexes, short debounces, and lazy-loaded screens reduce unnecessary work.

These safeguards do not imply unlimited capacity. Capacity depends on hosting limits, query volume, realtime connections, and network latency. Load-test expected concurrency and monitor actual response times/errors.

## Repository guide

```text
src/
  App.tsx                    Sign-in, dashboard, profile, contact settings
  attendance.ts              Server clock, clock RPCs, attendance/history data
  PasswordSettings.tsx       Self-service password modal
  EmojiAvatarPicker.tsx      Employee emoji selection
  supabase.ts                Public browser client and persistent Auth settings
  SuccessToast.tsx           Root success popup, approximately 1.2 seconds
  successNotifications.ts    Success notification dispatcher
  global.css                Tailwind tokens and workspace component styles
supabase/
  migrations/               Ordered schema, policies, functions, triggers, indexes
  functions/admin-api/      Deno Edge Function and backend helper tests
  tests/                    Isolated PostgreSQL tests and hosted checks
supabase-project.ps1        Owner/project-verified CLI wrapper
vercel.json                 Production security and no-index headers
.env.example                Public frontend environment template
```

Core tables are `employee_profiles`, `attendance`, `admin_users`, `employee_account_access`, and `admin_activity_log`. Server directory views exclude administrators from employee lists. Private helpers and password-operation records live under `app_private`; do not expose or bypass them with ad-hoc data edits.

Keep Tailwind tokens and shared `workspace-*`, `button-*`, and `form-field` classes aligned across both repositories. Use `showSuccessToast` for routine successes; errors/access warnings and one-time credentials stay visible. Never include credentials in popups or logs.

## Local development

Prerequisites: Git, Node.js/npm, access to the shared Supabase project, and Deno 2 for backend checks. This workspace has been built with Node 24; the checked-in Vite version requires Node `^20.19.0 || >=22.12.0`.

From the employee folder:

```powershell
npm ci
```

Create `.env.local` from `.env.example` only if it does not already exist. Configure:

```dotenv
VITE_SUPABASE_URL=https://fxldcjqqlhnbdrpapadu.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<project-publishable-key>
```

Only these public client values belong in frontend configuration. Never put service-role/secret keys, access tokens, or database passwords in a `VITE_` variable or commit an environment file.

```powershell
npm run dev
```

Open the URL Vite prints. In another terminal, run `npm ci` and `npm run dev` inside `tlcdashboard-admin`. Its `envDir: '..'` reads the parent employee folder's environment files. Restart servers after environment changes. A separately located admin clone needs public configuration in its own parent or process/build environment.

VS Code settings enable Deno only in `supabase/functions`, preserving React's normal TypeScript setup. Install the recommended Deno extension when editing backend code.

## Supabase configuration and releases

The existing production project is already provisioned. Do not recreate its database, owner, or migration history just to run a local frontend.

Required hosted Auth settings: email/password sign-in enabled, public signups disabled, and minimum password length 12. Configure Site URL/redirect allowlists for deployed origins and any recovery flows. Local `config.toml` does not prove the hosted project's current settings; verify hosted configuration separately when operating/recreating it.

Run remote commands through `supabase-project.ps1`. It checks the linked project, owner identity, and project access. It tries the named `tlcdashboard` profile, falling back to a default session only if the same checks pass. Correct a rejected identity rather than bypassing the guard.

If login/linking is needed:

```powershell
npx supabase login --name tlcdashboard --no-browser
npx supabase link --project-ref fxldcjqqlhnbdrpapadu --profile tlcdashboard
```

Authenticate as the project owner; keep tokens/passwords private. For an authorized backend release:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\supabase-project.ps1 db push --linked --dry-run
powershell -NoProfile -ExecutionPolicy Bypass -File .\supabase-project.ps1 db push --linked --yes
powershell -NoProfile -ExecutionPolicy Bypass -File .\supabase-project.ps1 functions deploy admin-api --use-api
```

Review pending migrations first. Apply schema changes, deploy `admin-api` with JWT verification enabled, then release compatible frontends. Do not use `--no-verify-jwt` or re-import all migrations in SQL Editor. Privileged credentials stay in the function's server environment.

Fresh-database prerequisite: migration `202610300002_admin_provisioning.sql` expects an already-created, confirmed Auth user for `codingbrain02@gmail.com`. The first attendance migration installs the profile trigger before this step. Create the owner through supported Auth tools, never direct `auth.users` inserts. For deployments predating the safe clock-out rollout, publish the frontend using `clock_out_shift_if_current` before applying `202610310006_remove_legacy_clock_out.sql`.

Each Git repository deploys to its own Vercel project. Build command: `npm run build`; output: `dist/`. Set the public Supabase URL/key in each project's build environment; local parent-folder files do not exist automatically in cloud builds. The apps use internal tabs rather than URL routes. Confirm folder/remote and obtain push approval for each release. Git/Vercel frontend builds do not apply SQL migrations or deploy Edge Functions.

## Verification

Run in each frontend's own folder:

```powershell
npm run lint
npm run build
git diff --check
```

Run backend checks from the employee repository:

```powershell
deno check --config supabase/functions/admin-api/deno.json supabase/functions/admin-api/index.ts
deno test supabase/functions/admin-api/employee-access.test.ts supabase/functions/admin-api/employee-search.test.ts
deno test --config supabase/tests/deno.json --allow-read supabase/tests/emoji_avatars.test.ts
deno run --config supabase/tests/deno.json --allow-read --allow-env --allow-sys supabase/tests/run-lifecycle.ts
```

The isolated runner uses in-memory PostgreSQL with synthetic Auth users/sessions; it never connects to production. Coverage includes lifecycle permissions/auditing, password transactions/session rules, emoji restrictions, and availability totals. It skips the `pg_trgm` search-index portion, which requires hosted Postgres validation. It does not emulate every hosted Auth behavior.

The guarded read-only availability check returns aggregate counts/permissions, not employee details:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\supabase-project.ps1 db query --linked --file supabase/tests/check_team_availability.sql --output-format json
```

Authenticated browser checks should use disposable accounts: simultaneous employees, stale-tab clock-out, sign-out/reopen during a shift, both admin roles, live contact/emoji changes, terminate/reverse/rehire, own-password session survival, and Super Admin target-session revocation. Include narrow screens, both themes, failed requests, and retries. A build or unauthenticated API probe is not an end-to-end integration test.

## Security and troubleshooting

Both sites are private workspaces and intentionally send no-index metadata/headers. Public SEO belongs on a separate website. `vercel.json` supplies CSP, framing restrictions, MIME protection, and other response headers; Vite dev/preview do not apply them. A custom Supabase domain requires updating CSP `connect-src` in both repositories.

Keep RLS, session guards, JWT verification, Auth rate limits, and server-only secrets intact. Do not assume CAPTCHA, MFA, offline attendance, verified capacity, or backup/alerting procedures are implemented without separate verification. Monitor errors/latency and establish backup/restore and incident procedures for critical operations.

| Symptom | Check |
| --- | --- |
| Sign-in not configured | Public URL/key, `.env.local`, restarted Vite process, or rebuilt Vercel deployment |
| `email_provider_disabled` | Hosted email/password provider; keep sign-in enabled while disabling public registration |
| Invalid credentials | Current email/latest password; a subsequent Super Admin change overrides an older password |
| CLI owner/access error | Named/default CLI identity, owner access, and exact project link; never bypass the guard |
| Admin data/totals unavailable | Pending migrations, deployed function, caller role/session, network, and retry controls |
| Delayed live changes | Realtime connection/publication, connectivity, focus/reconnect recovery, fallback refresh |
| Rehired employee still blocked | Pending access sync, latest credentials, enabled email sign-in, and a fresh session |

Preserve schema/audit history when reverting UI changes. Reverse an employment action explicitly instead of overwriting newer records with an old database backup. Keep passwords/tokens out of chat, screenshots, logs, and commits.
