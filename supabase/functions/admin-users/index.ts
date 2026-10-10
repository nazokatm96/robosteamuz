// RoboSTEAM admin-users Edge Function: account actions that need the service role, for admins only (admin.html).
//   POST { action: 'set_password',  user_id, password }  -> { ok: true }
//   POST { action: 'confirm_email', user_id }            -> { ok: true }
//   POST { action: 'delete_user',   user_id }            -> { ok: true }  (not yourself; profile, progress and quiz
//                                                           results go with the account: on delete cascade)
// The caller is identified by their own access token (Authorization: Bearer ...) and must be in public.admins
// (supabase/admin-schema.sql). The service role key is provided by Supabase as an env var and never leaves this function.
//
// Deploy (Supabase CLI):  supabase functions deploy admin-users --no-verify-jwt --project-ref wrmmmpdintjynwitltot
// or Dashboard -> Edge Functions -> Deploy a new function -> Via editor: name it admin-users, paste this file, and turn
// "Verify JWT with legacy secret" off (the function checks the token itself, which also works with the new JWT keys).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*', // auth is the bearer token, not cookies, so any origin is fine
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Who is calling, and are they an admin?
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'unauthorized' }, 401);
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json({ error: 'unauthorized' }, 401);
  const { data: row, error: adminError } = await admin.from('admins').select('user_id').eq('user_id', auth.user.id).maybeSingle();
  if (adminError) return json({ error: 'server_error' }, 500);
  if (!row) return json({ error: 'forbidden' }, 403);

  // 2. The action
  let body: { action?: string; user_id?: string; password?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }
  if (typeof body.user_id !== 'string' || !UUID.test(body.user_id)) return json({ error: 'bad_request' }, 400);

  if (body.action === 'delete_user') {
    // an admin can't delete their own account here, so the last admin can't lock everyone out by accident
    if (body.user_id === auth.user.id) return json({ error: 'cannot_delete_self' }, 400);
    const { error } = await admin.auth.admin.deleteUser(body.user_id);
    if (error) return json({ error: error.code || 'delete_failed' }, error.status && error.status < 500 ? error.status : 500);
    return json({ ok: true });
  }

  let attrs: { password?: string; email_confirm?: boolean };
  if (body.action === 'set_password') {
    const pw = body.password;
    // same rule as the site's forms (js/auth.js vNewPw): 8+ characters, at most 72 bytes (bcrypt limit)
    if (typeof pw !== 'string' || pw.length < 8 || new TextEncoder().encode(pw).length > 72) return json({ error: 'weak_password' }, 400);
    attrs = { password: pw };
  } else if (body.action === 'confirm_email') {
    attrs = { email_confirm: true };
  } else {
    return json({ error: 'unknown_action' }, 400);
  }

  const { error } = await admin.auth.admin.updateUserById(body.user_id, attrs);
  if (error) return json({ error: error.code || 'update_failed' }, error.status && error.status < 500 ? error.status : 500);
  return json({ ok: true });
});
