alter table public.client_communication_channels
    add column if not exists clickup_folder_id text;
