begin;

-- Add metadata to the existing authorized, bounded decoder in the same DB
-- round trip. Do not replace or broaden its visibility/encryption checks.
create function public.communication_native_message_detail(p_workspace_id uuid, p_message_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
    select to_jsonb(decoded) || jsonb_build_object('edited_at', message.edited_at)
    from public.communication_native_message(p_workspace_id,p_message_id) decoded
    join public.workspace_native_messages message on message.id=decoded.id and message.workspace_id=p_workspace_id;
$$;
revoke all on function public.communication_native_message_detail(uuid,uuid) from public,anon,service_role;
grant execute on function public.communication_native_message_detail(uuid,uuid) to authenticated;

-- Client delivery metadata is scoped to the exact authorized decoded row.
create function public.communication_client_message_detail(p_workspace_id uuid, p_message_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
    select jsonb_build_object('message',to_jsonb(decoded),'deliveries',coalesce((
        select jsonb_agg(jsonb_build_object('provider',d.provider,'provider_message_id',d.provider_message_id,
            'status',d.status,'error',d.error,'sent_at',d.sent_at,'delivered_at',d.delivered_at,'read_at',d.read_at,'failed_at',d.failed_at)
            order by d.created_at)
        from public.communication_message_deliveries d
        where d.workspace_id=p_workspace_id and d.client_message_id=decoded.id
    ),'[]'::jsonb))
    from public.communication_client_message(p_workspace_id,p_message_id) decoded;
$$;
revoke all on function public.communication_client_message_detail(uuid,uuid) from public,anon,service_role;
grant execute on function public.communication_client_message_detail(uuid,uuid) to authenticated;

-- One exact message, one conversation, one sender; no history decryption or
-- plaintext content. Recipients use the same current membership gate as jobs.
create function public.chat_push_context(p_workspace uuid,p_kind text,p_conversation uuid,p_message uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
    if p_kind='native' then
        select jsonb_build_object('workspaceSlug',w.slug,'messageCreatedAt',m.created_at,
            'conversationKind',c.kind,'senderName',coalesce(nullif(btrim(p.display_name),''),p.username,'A workspace member'),
            'teamName',t.name)
        into result
        from public.workspace_native_messages m
        join public.workspaces w on w.id=m.workspace_id
        join public.workspace_native_conversations c on c.id=m.conversation_id and c.workspace_id=m.workspace_id
        left join public.user_profiles p on p.user_id=m.sender_user_id
        left join public.workspace_teams t on t.id=c.team_id and t.workspace_id=m.workspace_id
        where m.workspace_id=p_workspace and m.conversation_id=p_conversation and m.id=p_message;
    elsif p_kind='client' then
        select jsonb_build_object('workspaceSlug',w.slug,'messageCreatedAt',m.created_at,
            'primaryName',r.primary_person_name,'businessName',r.business_name)
        into result
        from public.client_messages m
        join public.workspaces w on w.id=m.workspace_id
        join public.relationships r on r.id=m.relationship_id and r.workspace_id=m.workspace_id
        where m.workspace_id=p_workspace and m.relationship_id=p_conversation and m.id=p_message;
    else raise invalid_parameter_value;
    end if;
    if result is null then return null; end if;
    return result || jsonb_build_object('recipients',coalesce((
        select jsonb_agg(r.user_id) from public.chat_push_recipients(p_workspace,p_kind,p_conversation) r
    ),'[]'::jsonb));
end;
$$;
revoke all on function public.chat_push_context(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.chat_push_context(uuid,text,uuid,uuid) to service_role;

-- Combine initial eligibility and subscription lookup. The worker must still
-- recheck prepare_chat_push_delivery immediately before external delivery.
create function public.prepare_chat_push_subscription(p_id uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare prepared jsonb; subscription jsonb;
begin
    prepared := public.prepare_chat_push_delivery(p_id,p_lease);
    if prepared->>'state' is distinct from 'send' then return prepared; end if;
    select jsonb_build_object('endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth) into subscription
    from public.chat_push_deliveries d join public.web_push_subscriptions s on s.id=d.subscription_id and s.user_id=d.user_id
    where d.id=p_id and d.lease_token=p_lease;
    return prepared || jsonb_build_object('subscription',subscription);
end;
$$;
revoke all on function public.prepare_chat_push_subscription(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_chat_push_subscription(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
