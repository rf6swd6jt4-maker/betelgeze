create table if not exists public.workspace_invitations (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    email text not null,
    role text not null check (role in ('member', 'admin')),
    invited_by uuid not null references auth.users(id) on delete cascade,
    expires_at timestamptz not null default now() + interval '7 days',
    accepted_at timestamptz,
    created_at timestamptz not null default now()
);

create unique index if not exists workspace_invitations_workspace_email_idx
on public.workspace_invitations (workspace_id, email);

alter table public.workspace_invitations enable row level security;
