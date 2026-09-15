-- ASCII-only SQL avoids transport-dependent punctuation encoding.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create function public.sop_attachment_quote_matches(p_quote text,p_context text) returns boolean
language sql immutable set search_path=public as $$
 with spaces as (
  select chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279) chars
 ), normalized as (
  select btrim(regexp_replace(translate(p_quote,chars,repeat(' ',length(chars))),'\s+',' ','g')) quote,
         btrim(regexp_replace(translate(p_context,chars,repeat(' ',length(chars))),'\s+',' ','g')) context from spaces
 ) select coalesce(length(quote)>=12 and length(p_quote)<=400 and strpos(lower(context),lower(quote))>0,false) from normalized
$$;
revoke all on function public.sop_attachment_quote_matches(text,text) from public,anon,authenticated;
grant execute on function public.sop_attachment_quote_matches(text,text) to service_role;

do $migration$
declare def text; old_check text:=$old$strpos(lower(regexp_replace(s->>'instruction','\s+',' ','g')),lower(regexp_replace(trim(a->>'source_quote'),'\s+',' ','g')))=0$old$;
 old_asset text:=$old$strpos(lower(regexp_replace(c->>'description','\s+',' ','g')),lower(regexp_replace(trim(a->>'asset_quote'),'\s+',' ','g')))=0$old$;
begin
 select pg_get_functiondef('public.publish_sop_work_with_assets(uuid,uuid)'::regprocedure) into def;
 if position(old_check in def)=0 or position(old_asset in def)=0 then raise exception 'Unexpected attachment validator; migration was not applied.'; end if;
 def:=replace(def,old_check,$new$(not sop_attachment_quote_matches(a->>'source_quote',s->>'source_quote') and not sop_attachment_quote_matches(a->>'source_quote',s->>'instruction'))$new$);
 def:=replace(def,old_asset,$new$not sop_attachment_quote_matches(a->>'asset_quote',c->>'description')$new$);
 execute def;
 select pg_get_functiondef('public.finish_sop_extraction(uuid,uuid,text,jsonb,jsonb,text)'::regprocedure) into def;
 if position(quote_literal('SOP visual '||chr(183)||' ') in def)=0 and position(quote_literal('SOP visual '||chr(194)||chr(183)||' ') in def)=0 then raise exception 'Unexpected extraction title format; migration was not applied.'; end if;
 def:=replace(def,quote_literal('SOP visual '||chr(194)||chr(183)||' '),$new$('SOP visual '||chr(183)||' ')$new$);
 def:=replace(def,quote_literal('SOP visual '||chr(183)||' '),$new$('SOP visual '||chr(183)||' ')$new$);
 execute def;
end $migration$;

-- Repair only untouched machine-generated malformed titles. Preserve renamed
-- assets, descriptions, image bytes and all existing work-item links.
update public.assets a set title=left('SOP visual '||chr(183)||' '||i.location,200)
from public.sop_extracted_images i
where a.id=i.asset_id and a.workspace_id=i.workspace_id and a.native_kind='sop_extracted_image'
 and a.title=left('SOP visual '||chr(194)||chr(183)||' '||i.location,200);
notify pgrst,'reload schema';
commit;
