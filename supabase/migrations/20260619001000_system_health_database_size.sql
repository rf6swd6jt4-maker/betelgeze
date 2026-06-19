create or replace function public.get_system_health_database_size()
returns table(database_bytes bigint)
language sql
security definer
set search_path = pg_catalog
as $$
    select pg_database_size(current_database())::bigint as database_bytes;
$$;

revoke all on function public.get_system_health_database_size() from public;
grant execute on function public.get_system_health_database_size() to service_role;
