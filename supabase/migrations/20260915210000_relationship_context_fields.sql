-- Reuse existing columns and preserve omitted fields from older clients.
create or replace function public.save_relationship_background_command(
    p_workspace_id uuid, p_relationship_id uuid, p_user_id uuid, p_expected_updated_at timestamptz,
    p_request_id uuid, p_request_hash text, p_values jsonb
)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
    v_relationship public.relationships%rowtype;
    v_receipt public.relationship_background_command_receipts%rowtype;
    v_role text; v_values jsonb; v_version timestamptz;
begin
    if current_user <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted relationship runtime required'; end if;
    if public.workspace_user_can_access_relationship(p_workspace_id, p_relationship_id, p_user_id) is not true
       or not exists(select 1 from public.workspaces where id = p_workspace_id and status = 'active') then
        raise exception using errcode = '42501', message = 'Relationship access is required.';
    end if;
    if p_request_id is null or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' or p_expected_updated_at is null then
        raise exception using errcode = '22023', message = 'Relationship command identity is required.';
    end if;
    select * into v_relationship from public.relationships where workspace_id = p_workspace_id and id = p_relationship_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'Relationship not found.'; end if;
    v_role := public.workspace_role_for_user(p_workspace_id, p_user_id);
    if v_role is null or (v_role not in ('owner','admin') and v_relationship.seller_user_id is distinct from p_user_id
        and v_relationship.fulfilment_manager_user_id is distinct from p_user_id and v_relationship.pos_started_at is not null) then
        raise exception using errcode = '42501', message = 'Relationship seller, manager or workspace administrator required.';
    end if;
    select * into v_receipt from public.relationship_background_command_receipts
    where workspace_id = p_workspace_id and user_id = p_user_id and request_id = p_request_id;
    if found and (v_receipt.relationship_id <> p_relationship_id or v_receipt.request_hash <> p_request_hash) then
        raise exception using errcode = '22023', message = 'Relationship command identity was reused for different changes.';
    end if;
    if v_receipt.request_id is null and v_relationship.updated_at = p_expected_updated_at then
        if jsonb_typeof(p_values) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_values)) not between 9 and 12
           or not (p_values ?& array['primaryPersonName','businessName','primaryContactRole','primaryPhone','whatsappPhone','communicationPrimaryProvider','communicationDeliveryMode','primaryEmail','description'])
           or exists(select 1 from jsonb_each(p_values) where jsonb_typeof(value) <> 'string')
           or nullif(btrim(p_values->>'primaryPersonName'),'') is null
           or p_values->>'communicationPrimaryProvider' not in ('meta_whatsapp','twilio_sms')
           or p_values->>'communicationDeliveryMode' not in ('primary_only','primary_with_fallback','mirror') then
            raise exception using errcode = '22023', message = 'Invalid relationship background values.';
        end if;
        update public.relationships set
            primary_person_name = btrim(p_values->>'primaryPersonName'), business_name = nullif(btrim(p_values->>'businessName'),''),
            primary_contact_role = nullif(btrim(p_values->>'primaryContactRole'),''), primary_phone = nullif(btrim(p_values->>'primaryPhone'),''),
            whatsapp_phone = nullif(btrim(p_values->>'whatsappPhone'),''), communication_primary_provider = p_values->>'communicationPrimaryProvider',
            communication_delivery_mode = p_values->>'communicationDeliveryMode', primary_email = nullif(btrim(p_values->>'primaryEmail'),''),
            industry_value = case when p_values ? 'industryValue' then nullif(btrim(p_values->>'industryValue'),'') else industry_value end,
            website_url = case when p_values ? 'websiteUrl' then nullif(btrim(p_values->>'websiteUrl'),'') else website_url end,
            notes_summary = nullif(btrim(p_values->>'description'),''), location_value = case when p_values ? 'locationValue' then nullif(btrim(p_values->>'locationValue'),'') else location_value end
        where workspace_id = p_workspace_id and id = p_relationship_id returning * into v_relationship;
        insert into public.relationship_background_command_receipts(workspace_id,user_id,request_id,relationship_id,request_hash,committed_updated_at)
        values(p_workspace_id,p_user_id,p_request_id,p_relationship_id,p_request_hash,v_relationship.updated_at)
        returning * into v_receipt;
    end if;
    v_values := jsonb_build_object('primaryPersonName',v_relationship.primary_person_name,'businessName',coalesce(v_relationship.business_name,''),
        'industryValue',coalesce(v_relationship.industry_value,''),'websiteUrl',coalesce(v_relationship.website_url,''),
        'locationValue',coalesce(v_relationship.location_value,''),'primaryContactRole',coalesce(v_relationship.primary_contact_role,''),'primaryPhone',coalesce(v_relationship.primary_phone,''),
        'whatsappPhone',coalesce(v_relationship.whatsapp_phone,''),'communicationPrimaryProvider',v_relationship.communication_primary_provider,
        'communicationDeliveryMode',v_relationship.communication_delivery_mode,'primaryEmail',coalesce(v_relationship.primary_email,''),'description',coalesce(v_relationship.notes_summary,''));
    if v_receipt.request_id is null then
        return jsonb_build_object('ok',false,'conflict',true,'version',v_relationship.updated_at,'values',v_values,
            'error','Another user changed this relationship. Review their version before retrying your edits.');
    end if;
    return jsonb_build_object('ok',true,'version',v_receipt.committed_updated_at,'currentVersion',v_relationship.updated_at,'values',v_values);
end;
$$;

