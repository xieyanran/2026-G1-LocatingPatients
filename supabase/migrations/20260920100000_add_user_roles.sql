-- Staff roles. One row per authenticated user; assigned out-of-band (by an
-- admin, via SQL) after they sign up through Supabase Auth — there is no
-- self-serve role picker in Phase 1.
create table user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('nurse', 'doctor', 'coordinator', 'admin')),
  created_at timestamptz not null default now()
);

alter table user_roles enable row level security;

-- Staff can see the role list (needed for e.g. showing "assigned to" names
-- later); nobody but the row owner or an admin can change it directly —
-- role changes should go through the service role / SQL, not the app.
create policy "user_roles_select" on user_roles
for select to authenticated
using (true);

-- security definer + stable so RLS policies elsewhere can call this without
-- triggering recursive RLS checks on user_roles itself.
create function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.user_roles where user_id = auth.uid()
$$;
