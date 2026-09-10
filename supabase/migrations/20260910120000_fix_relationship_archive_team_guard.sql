-- Archiving closes a relationship as completed_lost. Closing an unsold
-- prospect must not validate POS, lock its allocations, or create a sold team.
create or replace function public.guard_relationship_delivery_team() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if old.pos_started_at is not null and new.seller_user_id is distinct from old.seller_user_id then raise exception 'Seller attribution is locked to the user who began POS'; end if;
 if old.team_locked_at is not null and (new.fulfilment_manager_user_id is distinct from old.fulfilment_manager_user_id or new.team_locked_at is distinct from old.team_locked_at) then raise exception 'The sold client team cannot be changed'; end if;
 if old.team_locked_at is null
   and old.lifecycle_phase in ('lead','potential_client','nurturing','completed_lost')
   and new.lifecycle_phase not in ('lead','potential_client','nurturing','completed_lost')
   and new.status <> 'archived' then
   perform public.validate_relationship_delivery_team(new.workspace_id,new.id);
   new.team_locked_at=now();
 end if;
 return new;
end $$;
