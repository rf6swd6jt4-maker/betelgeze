-- Narrow service-role commands. Existing records/links are not rewritten.
begin;

create table public.record_attachment_commands (
    workspace_id uuid not null references public.workspaces(id),
    actor_id uuid not null references auth.users(id),
    request_id uuid not null,
    kind text not null check (kind in ('asset','note')),
    payload jsonb not null,
    record_id uuid,
    status text not null check (status in ('accepted','rejected')),
    rejection_message text,
    check ((status='accepted' and record_id is not null and rejection_message is null) or (status='rejected' and record_id is null and rejection_message is not null)),
    created_at timestamptz not null default now(),
    primary key (workspace_id, actor_id, request_id)
);
alter table public.record_attachment_commands enable row level security;
revoke all on public.record_attachment_commands from public, anon, authenticated;
grant select, insert on public.record_attachment_commands to service_role;

create function public.assert_record_attachment_admin(p_workspace uuid, p_actor uuid) returns void
language plpgsql set search_path=public as $$
begin
    if current_user <> 'service_role' or p_actor is null or not exists (
        select 1 from workspace_memberships m join workspaces w on w.id=m.workspace_id
        where m.workspace_id=p_workspace and m.user_id=p_actor and m.role in ('owner','admin') and w.status='active'
    ) then raise exception 'Workspace administrator access required'; end if;
end $$;

create function public.attach_existing_record(p_workspace uuid,p_actor uuid,p_owner text,p_owner_id uuid,p_kind text,p_target uuid) returns void
language plpgsql set search_path=public as $$
begin
    perform assert_record_attachment_admin(p_workspace,p_actor);
    if p_owner is null or p_owner not in ('relationship','work-item','note') or p_kind is null or p_kind not in ('asset','note') then raise exception 'Invalid attachment'; end if;
    -- Every note-link writer shares this lock with relationship-delta commands.
    perform 1 from notes where workspace_id=p_workspace and id in
        (case when p_owner='note' then p_owner_id end,case when p_kind='note' then p_target end) order by id for update;
    if p_owner='relationship' then
        perform 1 from relationships where workspace_id=p_workspace and id=p_owner_id and status<>'archived' for key share;
    elsif p_owner='work-item' then
        perform 1 from work_items where workspace_id=p_workspace and id=p_owner_id for key share;
    else
        perform 1 from notes where workspace_id=p_workspace and id=p_owner_id;
    end if;
    if not found then raise exception 'Attachment owner unavailable'; end if;
    if p_kind='asset' then
        perform 1 from assets where workspace_id=p_workspace and id=p_target and metadata->>'archived_at' is null for key share;
    else
        perform 1 from notes where workspace_id=p_workspace and id=p_target;
    end if;
    if not found then raise exception 'Attachment unavailable'; end if;
    -- Re-read admission after the last potentially blocking owner/target lock.
    -- KEY SHARE intentionally does not block unrelated target metadata updates.
    perform assert_record_attachment_admin(p_workspace,p_actor);
    if p_owner='relationship' and not exists (select 1 from relationships where workspace_id=p_workspace and id=p_owner_id and status<>'archived') then raise exception 'Attachment owner unavailable'; end if;
    if p_owner='work-item' and not exists (select 1 from work_items where workspace_id=p_workspace and id=p_owner_id) then raise exception 'Attachment owner unavailable'; end if;
    if p_kind='asset' and not exists (select 1 from assets where workspace_id=p_workspace and id=p_target and metadata->>'archived_at' is null) then raise exception 'Attachment unavailable'; end if;
    if p_owner='relationship' and p_kind='asset' then
        insert into asset_relationships(workspace_id,relationship_id,asset_id) values(p_workspace,p_owner_id,p_target) on conflict(asset_id,relationship_id) do nothing;
    elsif p_owner='relationship' then
        -- The target note lock above also serializes relationship-delta writers.
        -- An existing pair remains a valid idempotent retry at (or above) the cap.
        if not exists (select 1 from note_relationships where note_id=p_target and relationship_id=p_owner_id)
           and (select count(*) from (select 1 from note_relationships where workspace_id=p_workspace and note_id=p_target limit 20) existing_links)>=20 then
            raise exception 'A note can link to at most 20 relationships';
        end if;
        insert into note_relationships(workspace_id,relationship_id,note_id) values(p_workspace,p_owner_id,p_target) on conflict(note_id,relationship_id) do nothing;
    elsif p_owner='work-item' and p_kind='asset' then
        -- Existing private-work-item trigger remains authoritative.
        insert into asset_work_items(workspace_id,work_item_id,asset_id) values(p_workspace,p_owner_id,p_target) on conflict(asset_id,work_item_id) do nothing;
    elsif p_owner='work-item' then
        insert into note_work_items(workspace_id,work_item_id,note_id) values(p_workspace,p_owner_id,p_target) on conflict(note_id,work_item_id) do nothing;
    elsif p_kind='asset' then
        insert into note_assets(workspace_id,note_id,asset_id) values(p_workspace,p_owner_id,p_target) on conflict(note_id,asset_id) do nothing;
    else
        if p_owner_id=p_target then raise exception 'A note cannot attach itself'; end if;
        insert into note_notes(workspace_id,parent_note_id,attached_note_id) values(p_workspace,p_owner_id,p_target) on conflict(parent_note_id,attached_note_id) do nothing;
    end if;
end $$;

create function public.save_note_text(p_workspace uuid,p_actor uuid,p_note uuid,p_field text,p_value text,p_baseline text) returns jsonb
language plpgsql set search_path=public as $$
declare n notes; current_value text;
begin
    perform assert_record_attachment_admin(p_workspace,p_actor);
    if p_field is null or p_field not in ('name','description') or p_value is null or p_baseline is null
       or length(btrim(p_value)) not between 1 and (case when p_field='name' then 160 else 20000 end) then raise exception 'Invalid note text'; end if;
    select * into n from notes where workspace_id=p_workspace and id=p_note for update;
    if not found then raise exception 'Note unavailable'; end if;
    perform assert_record_attachment_admin(p_workspace,p_actor);
    current_value:=case when p_field='name' then n.name else n.description end;
    -- Lost-ack retry of the same final value is safe and does not bump the version.
    if current_value=btrim(p_value) then return jsonb_build_object('ok',true,'version',n.updated_at); end if;
    if current_value is distinct from p_baseline then
        return jsonb_build_object('ok',false,'conflict',true,'value',current_value,'version',n.updated_at);
    end if;
    if p_field='name' then update notes set name=btrim(p_value) where id=p_note returning * into n;
    else update notes set description=btrim(p_value) where id=p_note returning * into n; end if;
    return jsonb_build_object('ok',true,'version',n.updated_at);
end $$;

create function public.edit_note_relationships(p_workspace uuid,p_actor uuid,p_note uuid,p_add uuid[],p_remove uuid[]) returns uuid[]
language plpgsql set search_path=public as $$
declare result uuid[];
begin
    perform assert_record_attachment_admin(p_workspace,p_actor);
    if p_add is null or p_remove is null or cardinality(p_add)>20 or cardinality(p_remove)>20
       or array_position(p_add,null) is not null or array_position(p_remove,null) is not null
       or p_add && p_remove then raise exception 'Invalid relationship changes'; end if;
    perform 1 from notes where workspace_id=p_workspace and id=p_note for update;
    if not found then raise exception 'Note unavailable'; end if;
    perform 1 from relationships where workspace_id=p_workspace and id=any(p_add) and status<>'archived' order by id for key share;
    perform assert_record_attachment_admin(p_workspace,p_actor);
    if (select count(distinct id) from relationships where workspace_id=p_workspace and id=any(p_add) and status<>'archived')
       <> (select count(distinct x) from unnest(p_add) x) then raise exception 'Relationship unavailable'; end if;
    -- Only the caller's explicit removals are removed; unseen concurrent additions survive.
    delete from note_relationships where workspace_id=p_workspace and note_id=p_note and relationship_id=any(p_remove);
    insert into note_relationships(workspace_id,note_id,relationship_id)
        select p_workspace,p_note,x from (select distinct unnest(p_add) x) requested
        on conflict(note_id,relationship_id) do nothing;
    select coalesce(array_agg(relationship_id order by relationship_id),'{}'::uuid[]) into result
        from note_relationships where workspace_id=p_workspace and note_id=p_note;
    if cardinality(result)>20 then raise exception 'A note can link to at most 20 relationships'; end if;
    return result;
end $$;

create function public.create_attachment_record(p_workspace uuid,p_actor uuid,p_request uuid,p_kind text,p_payload jsonb,p_reject_reason text default null) returns jsonb
language plpgsql set search_path=public as $$
declare prior record_attachment_commands; relationship_ids uuid[]; asset_ids uuid[]; work_id uuid; note_id uuid; title text; description text; rejected_message text;
begin
    perform assert_record_attachment_admin(p_workspace,p_actor);
    if p_request is null or p_kind is null or p_kind not in ('asset','note') or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid create request'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||p_actor::text||p_request::text,0));
    perform assert_record_attachment_admin(p_workspace,p_actor);
    select * into prior from record_attachment_commands where workspace_id=p_workspace and actor_id=p_actor and request_id=p_request;
    if found then
        if prior.kind<>p_kind or prior.payload<>p_payload then raise exception 'This request was already saved with different values. Recover the original request before creating another record'; end if;
        return jsonb_build_object('status',prior.status,'record_id',prior.record_id,'error',prior.rejection_message);
    end if;
    -- Lock acquisition and validation complete before a fresh authorization check.
    -- Authorization failures stay outside terminal-rejection handlers.
    begin
    if p_reject_reason is not null then
        if p_reject_reason='upload_expired' and p_kind='asset' then raise exception 'The upload expired. Choose the file again in the restored draft';
        else raise exception 'Invalid upload verification result'; end if;
    end if;
    if jsonb_typeof(p_payload->'relationship_ids') is distinct from 'array' or jsonb_typeof(p_payload->'asset_ids') is distinct from 'array'
       or jsonb_array_length(p_payload->'relationship_ids')>20 or jsonb_array_length(p_payload->'asset_ids')>20 then raise exception 'Invalid record links'; end if;
    select coalesce(array_agg(distinct x::uuid),'{}'::uuid[]) into relationship_ids from jsonb_array_elements_text(p_payload->'relationship_ids') x;
    select coalesce(array_agg(distinct x::uuid),'{}'::uuid[]) into asset_ids from jsonb_array_elements_text(p_payload->'asset_ids') x;
    work_id:=nullif(p_payload->>'work_item_id','')::uuid;
    note_id:=nullif(p_payload->>'note_id','')::uuid;
    title:=btrim(p_payload->>'title'); description:=btrim(coalesce(p_payload->>'description',''));
    if title is null or length(title) not between 1 and (case when p_kind='note' then 160 else 500 end) or length(description)>20000
       or (p_kind='note' and description='') then raise exception 'Invalid record name or description'; end if;
    -- All command paths acquire existing note locks before eligible target locks.
    if note_id is not null then
        perform 1 from notes where workspace_id=p_workspace and id=note_id for update;
        if not found then raise exception 'Note unavailable'; end if;
    end if;
    perform 1 from relationships where workspace_id=p_workspace and id=any(relationship_ids) and status<>'archived' order by id for key share;
    perform 1 from assets where workspace_id=p_workspace and id=any(asset_ids) and metadata->>'archived_at' is null order by id for key share;
    if work_id is not null then
        perform 1 from work_items where workspace_id=p_workspace and id=work_id for key share;
        if not found then raise exception 'Work item unavailable'; end if;
    end if;
    exception when raise_exception or invalid_text_representation or string_data_right_truncation or foreign_key_violation or check_violation then
        rejected_message:=sqlerrm;
    end;
    perform assert_record_attachment_admin(p_workspace,p_actor);
    if rejected_message is null then
    -- Recheck eligible targets after every known blocking acquisition. These are
    -- write-admission checks, not serialization of later archival/revocation.
    begin
    if (select count(*) from relationships where workspace_id=p_workspace and id=any(relationship_ids) and status<>'archived')<>cardinality(relationship_ids) then raise exception 'Relationship unavailable'; end if;
    if (select count(*) from assets where workspace_id=p_workspace and id=any(asset_ids) and metadata->>'archived_at' is null)<>cardinality(asset_ids) then raise exception 'Asset unavailable'; end if;
    if work_id is not null and not exists (select 1 from work_items where workspace_id=p_workspace and id=work_id) then raise exception 'Work item unavailable'; end if;
    if p_kind='note' then
        insert into notes(id,workspace_id,name,description,created_by) values(p_request,p_workspace,title,description,p_actor);
        insert into note_relationships(workspace_id,note_id,relationship_id) select p_workspace,p_request,unnest(relationship_ids);
        insert into note_assets(workspace_id,note_id,asset_id) select p_workspace,p_request,unnest(asset_ids);
        if work_id is not null then insert into note_work_items(workspace_id,note_id,work_item_id) values(p_workspace,p_request,work_id); end if;
        if note_id is not null then insert into note_notes(workspace_id,parent_note_id,attached_note_id) values(p_workspace,note_id,p_request); end if;
    else
        if cardinality(asset_ids)<>0 or p_payload->>'storage_path' is distinct from p_workspace::text||'/assets/'||p_actor::text||'/'||p_request::text||'/original'
           or jsonb_typeof(p_payload->'file_size') is distinct from 'number' or (p_payload->>'file_size')::bigint not between 1 and 524288000
           or p_payload->>'content_type' is null or length(p_payload->>'content_type') not between 1 and 200
           or p_payload->>'asset_kind' is null or p_payload->>'asset_kind' not in ('file','media','document') then raise exception 'Invalid verified upload'; end if;
        insert into assets(id,workspace_id,title,description,asset_kind,source_kind,storage_path,content_type,file_size,native_kind,metadata,created_by)
        values(p_request,p_workspace,title,nullif(description,''),p_payload->>'asset_kind','upload',p_payload->>'storage_path',p_payload->>'content_type',(p_payload->>'file_size')::bigint,'manual_upload',jsonb_build_object('created_from','global_create','original_name',p_payload->>'original_name'),p_actor);
        insert into asset_relationships(workspace_id,asset_id,relationship_id) select p_workspace,p_request,unnest(relationship_ids);
        if work_id is not null then insert into asset_work_items(workspace_id,asset_id,work_item_id) values(p_workspace,p_request,work_id); end if;
        if note_id is not null then insert into note_assets(workspace_id,note_id,asset_id) values(p_workspace,note_id,p_request); end if;
    end if;
    exception when raise_exception or invalid_text_representation or string_data_right_truncation or foreign_key_violation or check_violation then
        rejected_message:=sqlerrm;
    end;
    end if;
    if rejected_message is not null then
        insert into record_attachment_commands(workspace_id,actor_id,request_id,kind,payload,status,rejection_message) values(p_workspace,p_actor,p_request,p_kind,p_payload,'rejected',rejected_message);
        return jsonb_build_object('status','rejected','error',rejected_message);
    end if;
    insert into record_attachment_commands(workspace_id,actor_id,request_id,kind,payload,record_id,status) values(p_workspace,p_actor,p_request,p_kind,p_payload,p_request,'accepted');
    return jsonb_build_object('status','accepted','record_id',p_request);
end $$;

revoke all on function public.assert_record_attachment_admin(uuid,uuid),public.attach_existing_record(uuid,uuid,text,uuid,text,uuid),public.save_note_text(uuid,uuid,uuid,text,text,text),public.edit_note_relationships(uuid,uuid,uuid,uuid[],uuid[]),public.create_attachment_record(uuid,uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.assert_record_attachment_admin(uuid,uuid),public.attach_existing_record(uuid,uuid,text,uuid,text,uuid),public.save_note_text(uuid,uuid,uuid,text,text,text),public.edit_note_relationships(uuid,uuid,uuid,uuid[],uuid[]),public.create_attachment_record(uuid,uuid,uuid,text,jsonb,text) to service_role;
-- Match bounded catalogue ordering; existing notes already have this index shape.
create index if not exists assets_attachment_choices_idx on public.assets(workspace_id,updated_at desc,id desc) where metadata->>'archived_at' is null;
notify pgrst,'reload schema';
commit;
