-- A previous non-atomic transition could create the fulfilment plan before
-- the relationship phase was updated. Reconcile only plans whose onboarding
-- review has genuinely finished; incomplete reviews remain in review.
update public.relationships as relationship
set
    lifecycle_phase = 'fulfilment',
    updated_at = now()
where relationship.lifecycle_phase = 'onboarding_review'
  and exists (
      select 1
      from public.work_items as review
      join public.work_item_relationships as review_link
        on review_link.workspace_id = review.workspace_id
       and review_link.work_item_id = review.id
      where review_link.relationship_id = relationship.id
        and review.workspace_id = relationship.workspace_id
        and review.workflow_role = 'lifecycle_stage'
        and review.lifecycle_phase = 'onboarding_review'
        and review.status = 'done'
  )
  and exists (
      select 1
      from public.work_items as fulfilment
      join public.work_item_relationships as fulfilment_link
        on fulfilment_link.workspace_id = fulfilment.workspace_id
       and fulfilment_link.work_item_id = fulfilment.id
      where fulfilment_link.relationship_id = relationship.id
        and fulfilment.workspace_id = relationship.workspace_id
        and fulfilment.workflow_role = 'lifecycle_stage'
        and fulfilment.lifecycle_phase = 'fulfilment'
  );
