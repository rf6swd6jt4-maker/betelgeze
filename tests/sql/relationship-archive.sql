-- Run as postgres after the archive-team-guard migration. Disposable fixtures,
-- including activity and native team records, are rolled back together.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $test$
declare
    w uuid := gen_random_uuid();
    outside_w uuid := gen_random_uuid();
    owner_id uuid := gen_random_uuid();
    staff_id uuid := gen_random_uuid();
    service_id uuid := gen_random_uuid();
    r uuid;
    phase text;
    result jsonb;
    v_team_id uuid;
    locked_at timestamptz;
    rejected boolean;
begin
    insert into auth.users(id,email) values
        (owner_id,'archive-owner-'||owner_id||'@example.invalid'),
        (staff_id,'archive-staff-'||staff_id||'@example.invalid');
    insert into public.workspaces(id,name,slug) values
        (w,'Archive regression','archive-'||w),
        (outside_w,'Other archive workspace','archive-'||outside_w);
    insert into public.workspace_memberships(workspace_id,user_id,role) values
        (w,owner_id,'owner'),(w,staff_id,'staff'),(outside_w,owner_id,'owner');
    insert into public.onboarding_services(id,workspace_id,internal_code)
        values(service_id,w,'archive-regression');
    perform public.set_service_delivery_users(w,owner_id,service_id,array[owner_id]);

    -- Use the same service-role RPC and actor authorization as the danger zone.
    set local role service_role;
    foreach phase in array array['lead','potential_client','nurturing','completed_lost'] loop
        r := gen_random_uuid();
        insert into public.relationships(id,workspace_id,primary_person_name,lifecycle_phase,source_metadata)
            values(r,w,'Archive fixture',phase,'{"is_test":true}');
        rejected := false;
        begin
            perform public.archive_workspace_relationship(w,r,staff_id);
        exception when insufficient_privilege then rejected := true;
        end;
        assert rejected, 'Staff archived a relationship';
        rejected := false;
        begin
            perform public.archive_workspace_relationship(outside_w,r,owner_id);
        exception when raise_exception then rejected := true;
        end;
        assert rejected, 'Archive crossed the workspace boundary';

        result := public.archive_workspace_relationship(w,r,owner_id);
        assert result->>'archived' = 'true' and result->>'idempotent' = 'false', 'Archive failed for '||phase;
        assert exists(select 1 from public.relationships where id=r and status='archived' and lifecycle_phase='completed_lost' and team_locked_at is null), 'Archive locked an unsold team';
        assert not exists(select 1 from public.workspace_teams where relationship_id=r), 'Archive created an unsold team';
        result := public.archive_workspace_relationship(w,r,owner_id);
        assert result->>'idempotent' = 'true', 'Archive retry is not idempotent';
        assert (select count(*) from public.workspace_admin_activity where workspace_id=w and entity_id=r::text and event_key='relationship.archived')=1, 'Archive lost or duplicated its audit event';
    end loop;

    -- Partially configured POS must remain archivable; closing must not provide
    -- a route around validation when an unsold relationship is reopened.
    r := gen_random_uuid();
    insert into public.relationships(id,workspace_id,primary_person_name,lifecycle_phase)
        values(r,w,'Incomplete POS','potential_client');
    perform public.begin_relationship_pos(w,r,owner_id);
    rejected := false;
    begin update public.relationships set lifecycle_phase='sold' where id=r;
    exception when raise_exception then rejected := true;
    end;
    assert rejected, 'Incomplete POS was sold';
    update public.relationships set lifecycle_phase='completed_lost' where id=r;
    rejected := false;
    begin update public.relationships set lifecycle_phase='sold' where id=r;
    exception when raise_exception then rejected := true;
    end;
    assert rejected, 'Reopened prospect bypassed sale validation';
    update public.relationships set lifecycle_phase='potential_client' where id=r;
    result := public.archive_workspace_relationship(w,r,owner_id);
    assert result->>'archived' = 'true', 'Incomplete POS could not be archived';

    -- A real sale still locks its team. Archiving retains allocations, members,
    -- and the conversation, while marking the existing team archived.
    r := gen_random_uuid();
    insert into public.relationships(id,workspace_id,primary_person_name,lifecycle_phase)
        values(r,w,'Sold archive fixture','potential_client');
    perform public.begin_relationship_pos(w,r,owner_id);
    update public.relationships set fulfilment_manager_user_id=owner_id where id=r;
    insert into public.relationship_services(workspace_id,relationship_id,service_key,service_id,assignee_user_id)
        values(w,r,'archive-regression',service_id,owner_id);
    update public.relationships set lifecycle_phase='sold' where id=r;
    select team_locked_at into locked_at from public.relationships where id=r;
    select id into v_team_id from public.workspace_teams where relationship_id=r;
    assert locked_at is not null and v_team_id is not null, 'Sale did not lock and create its team';
    result := public.archive_workspace_relationship(w,r,owner_id);
    assert result->>'archived' = 'true', 'Sold relationship could not be archived';
    assert exists(select 1 from public.relationships where id=r and status='archived' and team_locked_at=locked_at and seller_user_id=owner_id and fulfilment_manager_user_id=owner_id), 'Archive changed sold attribution';
    assert exists(select 1 from public.relationship_services where relationship_id=r and assignee_user_id=owner_id), 'Archive changed sold service allocation';
    assert exists(select 1 from public.workspace_teams where id=v_team_id and archived_at is not null), 'Archive did not archive the existing team';
    assert exists(select 1 from public.workspace_team_members where workspace_team_members.team_id=v_team_id and user_id=owner_id), 'Archive removed team membership history';
    assert exists(select 1 from public.workspace_native_conversations where workspace_native_conversations.team_id=v_team_id), 'Archive removed conversation history';
    rejected := false;
    begin update public.relationships set fulfilment_manager_user_id=staff_id where id=r;
    exception when raise_exception then rejected := true;
    end;
    assert rejected, 'Archiving weakened sold team protection';
    reset role;
end;
$test$;
select 'PASS: prospect and sold archives, incomplete POS, retries, audit, authorization, and team preservation' as result;
rollback;
