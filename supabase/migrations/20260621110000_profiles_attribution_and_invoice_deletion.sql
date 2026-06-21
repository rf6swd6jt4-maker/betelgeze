alter table public.user_profiles add column if not exists avatar_path text;
alter table public.client_notes add column if not exists author_id uuid references auth.users(id) on delete set null;
alter table public.clients add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.client_sales add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.client_sales add column if not exists deleted_at timestamptz;
alter table public.client_sales add column if not exists deleted_by uuid references auth.users(id) on delete set null;

do $$ declare jed_id uuid; begin
  select id into jed_id from auth.users where lower(email) = 'jedryszczyk@scaylup.com' limit 1;
  if jed_id is not null then
    update public.clients set created_by = jed_id where created_by is null;
    update public.client_sales set created_by = jed_id where created_by is null;
  end if;
end $$;
