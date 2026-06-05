alter table public.client_communication_channels
    add column if not exists clickup_space_id text;
