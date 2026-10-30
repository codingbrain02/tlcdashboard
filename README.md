# TLC Attendance

Employee and administrator apps built with React, TypeScript, Vite, Tailwind CSS, and Supabase Auth/Postgres. The browser displays times in its own time zone. Clock-in and clock-out are recorded by Postgres, not by the device clock; an open shift continues while the site is closed or the employee is signed out.

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

Supabase keeps the Auth session in this browser. Signing out ends this device's session but does not end an open shift. The login screen remembers only the last account's name and email as a shortcut; its password is always required after sign-out. Use **Remove from this device** to clear that shortcut. Browser storage clearing, account revocation, and Auth session policies can still require a new login.

## Deployment notes

- Build with `npm run build` and host `dist/` on a static HTTPS host. Configure the host to serve `index.html` for the app's root; the app currently uses internal tabs rather than URL routes.
- Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the host's build environment. These are public client values; authorization depends on Supabase Auth, RLS, and the RPC checks.
- Apply pending migrations and deploy the updated `admin-api` function before releasing either frontend. Realtime subscriptions refresh attendance and employee contact details while the apps are open, with periodic refresh as a fallback. Test authenticated account creation, password change, email edits, and attendance in the browser before using the app for real attendance. Do not treat a successful frontend build as a database integration test.
- Configure your allowed Site URL/redirect URLs in Supabase Authentication settings to match the deployed HTTPS origin. Review Supabase email confirmation and password-recovery settings before inviting employees.
