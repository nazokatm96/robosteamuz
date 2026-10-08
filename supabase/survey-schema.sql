-- RoboSTEAM: public surveys (survey.html). Separate from the academy schema. Idempotent: safe to run again.
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Write-only from the website: anon (and signed-in visitors) may INSERT a response, nothing else.
-- Reading, editing and deleting is only possible with the service role (dashboard), which bypasses RLS, and admins
-- read it through admin_survey_responses() (supabase/admin-schema.sql). The site must therefore never call .select()
-- on this table, not even after an insert.

-- 1. Table ---------------------------------------------------------------------------------------------
create table if not exists public.survey_responses (
  id         uuid primary key default gen_random_uuid(),
  role       text not null check (role in ('student', 'teacher')),
  name       text not null,
  phone      text not null,
  age_range  text,
  region     text,
  answers    jsonb not null,   -- {"q1": "...", "q2": ["...", "..."], "q4_examples": "...", ...}
  created_at timestamptz not null default now()
);

comment on table public.survey_responses is 'Survey answers from survey.html. Insert-only for anon/authenticated; read via service role only.';

-- 2. Validation at the database level (re-created on every run, so edits here take effect) --------------
alter table public.survey_responses drop constraint if exists survey_name_check;
alter table public.survey_responses add constraint survey_name_check
  check (char_length(btrim(name)) between 1 and 80);

-- E.164: "+" and 8-15 digits. The site always sends Uzbek numbers as +998XXXXXXXXX.
alter table public.survey_responses drop constraint if exists survey_phone_check;
alter table public.survey_responses add constraint survey_phone_check
  check (btrim(phone) <> '' and phone ~ '^\+[1-9][0-9]{7,14}$');

-- Must match AGE_RANGES, TEACHER_AGE_RANGES and REGIONS in js/survey-questions.js
alter table public.survey_responses drop constraint if exists survey_age_range_check;
alter table public.survey_responses add constraint survey_age_range_check
  check (age_range is null or age_range in ('7-9 yosh', '10-12 yosh', '13-15 yosh', '16-18 yosh',
                                            '20-29 yosh', '30-39 yosh', '40-49 yosh', '50+ yosh'));

alter table public.survey_responses drop constraint if exists survey_region_check;
alter table public.survey_responses add constraint survey_region_check
  check (region is null or region in (
    'Andijon viloyati', 'Buxoro viloyati', 'Farg''ona viloyati', 'Jizzax viloyati', 'Namangan viloyati', 'Qashqadaryo viloyati',
    'Samarqand viloyati', 'Sirdaryo viloyati', 'Surxondaryo viloyati', 'Toshkent shahar', 'Toshkent viloyati', 'Xorazm viloyati'));

-- Students give a student age range and region; teachers give a teacher age range and no region.
-- Teacher age may be null: responses sent before the teacher age step was added have none.
alter table public.survey_responses drop constraint if exists survey_role_fields_check;
alter table public.survey_responses add constraint survey_role_fields_check
  check ((role = 'student' and age_range in ('7-9 yosh', '10-12 yosh', '13-15 yosh', '16-18 yosh') and region is not null)
      or (role = 'teacher' and (age_range is null or age_range in ('20-29 yosh', '30-39 yosh', '40-49 yosh', '50+ yosh'))
          and region is null));

-- answers must be a JSON object of a sane size (stops junk/oversized payloads from the public endpoint)
alter table public.survey_responses drop constraint if exists survey_answers_check;
alter table public.survey_responses add constraint survey_answers_check
  check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 16384);

create index if not exists survey_responses_created_at_idx on public.survey_responses (created_at desc);
create index if not exists survey_responses_role_idx on public.survey_responses (role);

-- 3. Privileges: insert-only, and only the answer columns (id and created_at are always set by the database) --
revoke all on table public.survey_responses from public, anon, authenticated;
grant insert (role, name, phone, age_range, region, answers) on table public.survey_responses to anon, authenticated;

-- 4. Row Level Security: one INSERT policy, no SELECT / UPDATE / DELETE policies --------------------------
alter table public.survey_responses enable row level security;

drop policy if exists "Anyone can submit a survey response" on public.survey_responses;
create policy "Anyone can submit a survey response"
  on public.survey_responses
  for insert
  to anon, authenticated   -- authenticated too: a visitor who is signed in to the academy sends their user token
  with check (true);
