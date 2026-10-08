-- RoboSTEAM admin panel (admin.html): admin role, content editing, lesson videos, quizzes, users and survey answers.
-- Idempotent: safe to run again. Run AFTER schema.sql, academy-schema.sql and survey-schema.sql.
-- Re-running academy-schema.sql resets the table grants, so run this file again after it.
-- Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Make someone an admin (they must have signed up first), then run it in the SQL editor:
--   insert into public.admins (user_id) select id from auth.users where email = 'admin@example.com' on conflict do nothing;
-- Remove an admin:
--   delete from public.admins where user_id = (select id from auth.users where email = 'admin@example.com');
--
-- Setting another user's password needs the service role, so that part is the admin-users Edge Function
-- (supabase/functions/admin-users/index.ts).

-- 1. Admins -------------------------------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.admins is 'Users who may use admin.html. Edited in the SQL editor only (no API access at all).';

alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;
-- No policies: nobody can read or change this table through the API. is_admin() reads it as its owner.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- 2. Modules and lessons: admins can read everything (drafts too) and edit --------------------------
-- These sit next to the "read published" policies from academy-schema.sql; a row is visible if either allows it.
drop policy if exists "Modules: admins manage" on public.modules;
create policy "Modules: admins manage"
  on public.modules for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Lessons: admins manage" on public.lessons;
create policy "Lessons: admins manage"
  on public.lessons for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant insert, update, delete on public.modules, public.lessons to authenticated;

alter table public.modules drop constraint if exists modules_title_check;
alter table public.modules add constraint modules_title_check check (char_length(btrim(title)) between 1 and 120);
alter table public.lessons drop constraint if exists lessons_title_check;
alter table public.lessons add constraint lessons_title_check check (char_length(btrim(title)) between 1 and 160);

-- 3. Lesson videos (private bucket lesson-videos from academy-schema.sql) ------------------------------
-- Admins upload, replace and delete files. Learners may create a signed URL only for a file that is attached
-- to a lesson they can see: the lessons subquery runs under the lessons policies (published lesson + module).
drop policy if exists "Lesson videos: admins manage" on storage.objects;
create policy "Lesson videos: admins manage"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'lesson-videos' and (select public.is_admin()))
  with check (bucket_id = 'lesson-videos' and (select public.is_admin()));

drop policy if exists "Lesson videos: signed-in users read published lessons" on storage.objects;
create policy "Lesson videos: signed-in users read published lessons"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'lesson-videos'
         and exists (select 1 from public.lessons l where l.video_path = storage.objects.name));

-- 4. Quizzes ------------------------------------------------------------------------------------------
-- Questions belong to a lesson. Learners never read this table directly (the correct answer is in it): they get
-- the questions from quiz_for_lesson() and send their answers to submit_quiz(), which checks them in the database.
create table if not exists public.quiz_questions (
  id            uuid primary key default gen_random_uuid(),
  lesson_id     uuid not null references public.lessons (id) on delete cascade,
  prompt        text not null,
  options       text[] not null,
  correct_index int  not null,
  order_index   int  not null default 0,
  created_at    timestamptz not null default now()
);

alter table public.quiz_questions drop constraint if exists quiz_prompt_check;
alter table public.quiz_questions add constraint quiz_prompt_check check (char_length(btrim(prompt)) between 1 and 500);
alter table public.quiz_questions drop constraint if exists quiz_options_check;
alter table public.quiz_questions add constraint quiz_options_check
  check (cardinality(options) between 2 and 6 and array_position(options, null) is null);
alter table public.quiz_questions drop constraint if exists quiz_correct_check;
alter table public.quiz_questions add constraint quiz_correct_check check (correct_index >= 0 and correct_index < cardinality(options));

create index if not exists quiz_questions_lesson_idx on public.quiz_questions (lesson_id, order_index);

-- Latest result per (user, lesson). Written only by submit_quiz().
create table if not exists public.quiz_results (
  user_id    uuid not null references auth.users (id) on delete cascade,
  lesson_id  uuid not null references public.lessons (id) on delete cascade,
  score      int  not null check (score >= 0),
  total      int  not null check (total >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create index if not exists quiz_results_lesson_idx on public.quiz_results (lesson_id);

comment on table public.quiz_questions is 'Lesson quiz questions. Admins only; learners use quiz_for_lesson() / submit_quiz().';
comment on table public.quiz_results is 'Latest quiz score per user and lesson, written by submit_quiz().';

alter table public.quiz_questions enable row level security;
alter table public.quiz_results   enable row level security;

drop policy if exists "Quiz questions: admins manage" on public.quiz_questions;
create policy "Quiz questions: admins manage"
  on public.quiz_questions for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Quiz results: read own rows or admin" on public.quiz_results;
create policy "Quiz results: read own rows or admin"
  on public.quiz_results for select
  to authenticated
  using ((select auth.uid()) = user_id or (select public.is_admin()));

revoke all on public.quiz_questions, public.quiz_results from anon, authenticated;
grant select, insert, update, delete on public.quiz_questions to authenticated;
grant select on public.quiz_results to authenticated;

-- The quiz of a lesson the caller can see, without the answers.
create or replace function public.quiz_for_lesson(p_lesson_id uuid)
returns table (id uuid, prompt text, options text[])
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.prompt, q.options
  from public.quiz_questions q
  where q.lesson_id = p_lesson_id
    and (select auth.uid()) is not null
    and exists (select 1 from public.lessons l join public.modules m on m.id = l.module_id
                where l.id = p_lesson_id and ((l.published and m.published) or public.is_admin()))
  order by q.order_index, q.created_at;
$$;

-- p_answers: {"<question id>": <chosen option index>, ...}. Unanswered questions count as wrong.
-- Returns {"score": 2, "total": 3, "results": [{"id": "...", "correct": true, "correct_index": 1}, ...]}.
create or replace function public.submit_quiz(p_lesson_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid     uuid := auth.uid();
  v_total int;
  v_score int;
  v_rows  jsonb;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'answers must be a JSON object' using errcode = '22023';
  end if;
  if not exists (select 1 from public.lessons l join public.modules m on m.id = l.module_id
                 where l.id = p_lesson_id and ((l.published and m.published) or public.is_admin())) then
    raise exception 'lesson not found' using errcode = 'P0002';
  end if;

  select count(*)::int,
         count(*) filter (where p_answers ->> q.id::text = q.correct_index::text)::int,
         coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id,
           'correct', coalesce(p_answers ->> q.id::text = q.correct_index::text, false),
           'correct_index', q.correct_index) order by q.order_index, q.created_at), '[]'::jsonb)
    into v_total, v_score, v_rows
  from public.quiz_questions q
  where q.lesson_id = p_lesson_id;

  if v_total > 0 then
    insert into public.quiz_results (user_id, lesson_id, score, total)
    values (uid, p_lesson_id, v_score, v_total)
    on conflict (user_id, lesson_id) do update
      set score = excluded.score, total = excluded.total, updated_at = now();
  end if;

  return jsonb_build_object('score', v_score, 'total', v_total, 'results', v_rows);
end;
$$;

revoke execute on function public.quiz_for_lesson(uuid), public.submit_quiz(uuid, jsonb) from public, anon;
grant execute on function public.quiz_for_lesson(uuid), public.submit_quiz(uuid, jsonb) to authenticated;

-- 5. Users (read-only list for admins; emails live in auth.users, which the API can't read) ---------------
create or replace function public.admin_list_users()
returns table (
  id              uuid,
  email           text,
  full_name       text,
  level           text,
  created_at      timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed boolean,
  lessons_done    int,
  is_admin        boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text, p.full_name, p.level, u.created_at, u.last_sign_in_at,
         u.email_confirmed_at is not null,
         (select count(*)::int from public.lesson_progress lp where lp.user_id = u.id and lp.completed),
         exists (select 1 from public.admins a where a.user_id = u.id)
  from auth.users u
  left join public.profiles p on p.id = u.id
  where public.is_admin()          -- everyone else gets an empty list
  order by u.created_at desc;
$$;

revoke execute on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

-- 6. Survey answers (survey_responses stays insert-only for the site; admins read it through this) --------
create or replace function public.admin_survey_responses()
returns setof public.survey_responses
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.survey_responses where public.is_admin() order by created_at desc;
$$;

revoke execute on function public.admin_survey_responses() from public, anon;
grant execute on function public.admin_survey_responses() to authenticated;

-- Delete one answer (spam, test entries, someone asking to be removed). Returns false if it was already gone.
create or replace function public.admin_delete_survey_response(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  delete from public.survey_responses where id = p_id;
  return found;
end;
$$;

revoke execute on function public.admin_delete_survey_response(uuid) from public, anon;
grant execute on function public.admin_delete_survey_response(uuid) to authenticated;

-- 7. Check: every table in public must have RLS on. This should return no rows.
-- select tablename from pg_tables where schemaname = 'public' and not rowsecurity;
