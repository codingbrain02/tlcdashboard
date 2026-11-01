# TLC Attendance

Employee and administrator apps built with React, TypeScript, Vite, Tailwind CSS, and Supabase Auth/Postgres. The browser displays times in its own time zone. Clock-in and clock-out are recorded by Postgres, not by the device clock; an open shift continues while the site is closed or the employee is signed out.

## Workspace design

Both apps use matching Tailwind design tokens and `workspace-*`, `button-*`, and `form-field` components in their respective `src/global.css` files. Keep these foundations aligned across the independent repositories. The interface uses system fonts, neutral surfaces, a slate navigation rail, restrained indigo actions, and semantic status colors. No external fonts, image requests, or additional UI dependencies are needed.

Navigation collapses below 1024px with an explicitly labeled, expanded-state menu control; desktop navigation and account settings stay reachable in a scrolling sidebar. Both workspaces include a keyboard skip link, visible focus states, and reduced-motion support. Employee pages prioritize the time clock, compact hour totals, contact details, and attendance records. Profile customization remains emoji-only and employee-only. The redesign does not change authentication, authorization, realtime subscriptions, password sessions, or attendance calculations.

## Supabase and first administrator setup

1. The project uses versioned migrations in [`supabase/migrations/`](supabase/migrations/). Apply only pending migrations with the guarded CLI; **do not import the whole folder again in SQL Editor.**
2. In **Authentication → Users**, create `codingbrain02@gmail.com` with a private password and confirm the email. This is an application Auth user, separate from your Supabase dashboard login. Never insert directly into `auth.users`.
3. The Supabase CLI is linked to project `fxldcjqqlhnbdrpapadu`. The second migration granted the confirmed first Auth user the sole `super_admin` role. You can sign in to a dedicated CLI profile with `npx supabase login --name tlcdashboard --no-browser` using the Supabase account that owns this project. Run remote commands through `powershell -ExecutionPolicy Bypass -File .\supabase-project.ps1 <supabase command>`. The wrapper uses that profile when available; otherwise it accepts the default CLI session only after verifying the owner email, project access, and linked project. A different project's login cannot silently take over. Do not share or commit the access token.
4. The `admin-api` Edge Function must be deployed after changes with JWT verification enabled. The server owns the service key. Never put a service-role or secret key in a `VITE_` variable or browser code.
5. In **Authentication → Providers → Email**, disable public signups. Employees are created only through the admin app. The admin app generates a temporary password and requires a change at first sign-in; it does not send invitation emails.
6. Put the project URL and **publishable key** in the parent project's `.env.local` using `.env.example`. The admin app reads the same public values through Vite's `envDir: '..'`. Restart both Vite servers after changing environment values.

Share temporary passwords privately, never through chat or a repository. The Super Administrator signs in with their real email; other administrators sign in with a unique username and password. Ordinary administrators see only a “Super Administrator” label, not the owner's email or Auth details.

## Run and verify locally

```text
npm install
npm run dev
npm run build
```

For the admin app, run the same commands inside `tlcdashboard-admin/`. No second Supabase project is needed.

The `admin-api` Edge Function uses Deno, not the browser TypeScript compiler. For VS Code, install the recommended Deno extension and the Deno CLI (`npm install -g deno`), then reload the editor. The checked-in `.vscode/settings.json` enables Deno only under `supabase/functions`; the React app keeps its existing TypeScript setup. Check the function with `deno check supabase/functions/admin-api/index.ts`.

After the migration, sign in and verify that clock-in creates one `attendance` row with `clock_out = null`. Reload or sign out and back in: the same shift should still be active. Clock out and confirm that the *same row* now has a `clock_out` timestamp; the next clock-in should make a new row. Test another employee account to confirm each person sees only their own profile and attendance. Test both light/dark themes and a narrow phone viewport.

The dashboard fetches records overlapping the employee's current local Monday–Sunday week for its totals, plus recent shifts. The profile history loads older records in pages as the fixed-height log is scrolled. The displayed clock uses a server timestamp plus the browser's monotonic elapsed time between resynchronizations. The device's wall clock does not set attendance timestamps.

Employees can click their avatar to choose from 48 preset emojis. Personal photos, uploads, image URLs and arbitrary text are not supported. The selected emoji is saved on the employee profile, appears across the employee app and remembered login shortcut, and updates in the admin directory/profile through the existing realtime subscriptions. Only the employee's active, fully configured session can use the avatar RPC; it cannot change anyone else's picture or any other profile field. Apply migrations `202611010007_employee_emoji_avatar.sql` and `202611010008_employee_emoji_directory.sql`, then deploy `admin-api` before releasing the frontends. Avatar changes do not affect passwords, sessions or attendance.

Supabase keeps the Auth session in this browser. Signing out ends this device's session but does not end an open shift. The login screen remembers only the last account's name and email as a shortcut; its password is always required after sign-out. Use **Remove from this device** to clear that shortcut. Browser storage clearing, account revocation, and Auth session policies can still require a new login.

## Deployment notes

- Build with `npm run build` and host `dist/` on a static HTTPS host. Configure the host to serve `index.html` for the app's root; the app currently uses internal tabs rather than URL routes.
- Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the host's build environment. These are public client values; authorization depends on Supabase Auth, RLS, and the RPC checks.
- Apply pending migrations and deploy the updated `admin-api` function before releasing either frontend. Realtime subscriptions refresh attendance and employee contact details while the apps are open, with periodic refresh as a fallback. Test authenticated account creation, password change, email edits, and attendance in the browser before using the app for real attendance. Do not treat a successful frontend build as a database integration test.
- Configure your allowed Site URL/redirect URLs in Supabase Authentication settings to match the deployed HTTPS origin. Review Supabase email confirmation and password-recovery settings before inviting employees.

## Production operations and limits

### Employee lifecycle and activity logs

Admins and the Super Administrator can terminate, reverse termination, or rehire an employee from the employee profile. Each action requires confirmation. Termination requires a category; Other also requires details. It ends the current shift as Terminated, blocks data access, and sends a minimal live status message that signs the employee out. Reversal and rehire restore the same account but require a fresh sign-in; old sessions and stopped shifts stay closed. Rehire records a new employment start date. Previous attendance is retained.

Only the Super Administrator can edit profile details, sign-in email, registration/employment dates and existing attendance, or view Activity Log. Edits show current and proposed values before confirmation. Stale confirmations and overlapping shift corrections are rejected. Employee IDs remain fixed. Logs record the verified admin, employee, timestamp, reason and before/after values. Logs start when this feature is enabled; historical actors are not guessed. No passwords or tokens are logged.

The database denies access immediately. The Edge Function synchronizes Auth sign-in bans through the supported Auth API. If that service fails, the employee profile exposes a retry for access synchronization; termination remains enforced by the database and old sessions remain blocked after restoration. An offline device receives the sign-out message when it reconnects. A status change does not erase data already displayed or downloaded on that device.

Release order: apply both `202611010001_employee_lifecycle.sql` and `202611010002_employee_lifecycle_views.sql`, deploy `admin-api`, then release both frontends together. The view update runs in its own transaction to avoid lock conflicts with live directory queries. Keep the schema/audit history when reverting frontend code; reverse a termination explicitly rather than restoring an old database backup over newer records.

Database regression checks run without live credentials:

```text
deno run --config supabase/tests/deno.json --allow-read --allow-env --allow-sys supabase/tests/run-lifecycle.ts
deno test supabase/functions/admin-api/employee-access.test.ts
```

The isolated PostgreSQL runner applies the real schema migrations and access policies with synthetic Auth tables/users. The hosted check also runs the migration and SQL tests inside one transaction ending in ROLLBACK. pg_trgm performance indexes are checked on hosted Postgres; the isolated engine skips that extension.

### Password management

Employees, administrators and the Super Administrator use Change my password in the sidebar account area. Self-service changes require the current password and a different new password of at least 12 characters. The current device stays signed in; other sessions are revoked. First-sign-in password setup also keeps the current session and opens the dashboard after completion.

Only the Super Administrator can directly set someone else's password: Employees > View profile > Change password, or Administrators > Change password. Enter a new password and select Save password; it applies immediately without a confirmation dialog, current-password prompt or temporary-password step and signs the target account out of all devices. Share the new password privately. Passwords are never retrievable or included in activity logs. A password change does not stop a shift or reactivate a terminated employee. Newly created accounts still receive temporary passwords requiring a first-sign-in change.

Apply password migrations through `202611010006_preserve_own_password_session.sql` before deploying the updated `admin-api` and both frontends. Auth's password transaction applies setup flags, session cutoffs and the success audit atomically, using a server-only operation marker established before Auth writes the password. Self-service uses the authenticated Auth user endpoint to retain the current session and revoke others; administrative changes use the Auth admin endpoint to revoke every session and advance application cutoffs. SQL regression coverage includes unauthorized password changes, request replay, Auth write ordering and rehashes, terminated accounts, setup flags, audit records, shift preservation and current-session survival. Run authenticated browser tests using disposable accounts before treating the release as verified end-to-end.

### Deployment safeguards

- The employee and admin apps contain private account data, so both send `noindex` headers and meta tags. Search-engine optimization belongs on a separate public website, not behind these sign-in screens.
- The first JavaScript bundle is split from phone-number formatting and admin detail screens. Database indexes support directory sorting/search and recent attendance. A 1 ms end-to-end load is not realistic over the internet; monitor real-user load times and the 95th-percentile API latency after deployment.
- Public signups are disabled and the Auth minimum password length is 12. Keep this setting, email confirmations for any other Auth flows, JWT verification on `admin-api`, and the service-role key server-side. Check these settings again after recreating a Supabase project.
- One open shift per employee is enforced by a database unique index. Clock-out must supply the exact open shift ID so a stale browser tab cannot close a newer shift. When upgrading an existing deployment, publish the frontend using `clock_out_shift_if_current` before applying `202610310006_remove_legacy_clock_out.sql`; new installations can apply all migrations in order.
- The employee can change their sign-in email immediately after re-entering their current password. As requested, the new mailbox is **not verified** first. A mistyped or attacker-controlled address can prevent recovery or redirect future account mail. Administrators should have a verified, private recovery procedure before relying on this for production.
- Test with at least two employee accounts at the same time, including simultaneous clock-ins, a stale-tab clock-out, sign-out during an open shift, and administrator visibility. A build and a credential-free 401 probe do not replace authenticated browser tests, monitoring, backup/restore drills, or a security review.
