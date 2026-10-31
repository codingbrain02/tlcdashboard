// Isolated PostgreSQL engine. Never connects to Supabase or reads app secrets.
// Run: deno run --config supabase/tests/deno.json --allow-read --allow-env --allow-sys supabase/tests/run-lifecycle.ts
import { PGlite } from 'npm:@electric-sql/pglite@0.5.12'

const database = new PGlite()
try {
  await database.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key, email text, aud text, role text,
      phone text, encrypted_password text, email_confirmed_at timestamptz,
      raw_user_meta_data jsonb default '{}'
    );
    create table auth.sessions (
      id uuid primary key, user_id uuid references auth.users(id),
      created_at timestamptz, updated_at timestamptz, aal text
    );
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as
      $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to authenticated;
    create publication supabase_realtime;
  `)
  const directory = new URL('../migrations/', import.meta.url)
  const names: string[] = []
  for await (const entry of Deno.readDir(directory)) if (entry.name.endsWith('.sql')) names.push(entry.name)
  for (const name of names.sort()) {
    let sql = await Deno.readTextFile(new URL(name, directory))
    // pg_trgm performance indexes are validated against hosted Postgres. All
    // tables, views, roles, policies, triggers and lifecycle functions run here.
    if (name === '202610310004_directory_performance.sql') sql = sql.split('-- Substring search')[0] + '\ncommit;'
    await database.exec(sql)
    if (name === '202610300001_employee_attendance.sql') {
      await database.exec(`insert into auth.users (id, email, email_confirmed_at)
        values (gen_random_uuid(), 'codingbrain02@gmail.com', now())`)
    }
  }
  await database.exec('begin;')
  const results = await database.exec(await Deno.readTextFile(new URL('./employee_lifecycle.sql', import.meta.url)))
  await database.exec('rollback;')
  console.log(results.at(-1)?.rows)
  console.log('Isolated lifecycle database tests passed. No live data was accessed.')
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Database tests failed')
  Deno.exitCode = 1
} finally {
  await database.close()
}
