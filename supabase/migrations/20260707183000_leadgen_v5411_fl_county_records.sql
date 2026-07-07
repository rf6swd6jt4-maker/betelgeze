-- Lead Gen v5.4.11 Florida county property appraiser and clerk record sources.
-- Property appraisers can strengthen owner discovery after strict parcel matching.
-- Clerk filings mostly strengthen scoring/corroboration, with only cautious DBA-style owner extraction.

with source_rows(
    source_key,
    label,
    family,
    source_points,
    owner_identity_points,
    business_support_points,
    access_method,
    rate_limit_ms,
    coverage,
    metadata
) as (
    values
        (
            'property.fl.miamidade_appraiser',
            'Miami-Dade property appraiser',
            'property_records',
            2,
            1,
            2,
            'public_api',
            650,
            '{"states":["FL"],"cities":["miami"],"industries":["all_enabled"]}'::jsonb,
            jsonb_build_object(
                'adapter', 'fl_county_property_appraiser',
                'county_source', 'miami_dade_property_appraiser',
                'source_url', 'https://apps.miamidadepa.gov/propertysearch/',
                'provenance_url', 'https://apps.miamidadepa.gov/propertysearch/',
                'claim_profile', 'florida_county_property_appraiser_parcel_corroboration',
                'identity_claim_kind', 'owner_identity',
                'person_role', 'parcel_owner_after_strict_address_or_entity_match',
                'query_limit', 5,
                'search_term_limit', 4,
                'owner_identity_points_on_match', 1,
                'owner_phone_points_on_match', 0,
                'business_support_points_on_match', 2,
                'source_role', 'county_property_appraiser_owner_identity_cautious',
                'pass', 'owner_identity_v5_4_11_fl_county_records',
                'caution', 'Parcel owners can be landlords, customers, trusts, or related entities. Owner names are only recorded after a strict address/entity match and real-person gate.',
                'field_map', jsonb_build_object(
                    'business_name', jsonb_build_array('business_name', 'owner_business_name'),
                    'owner_name', jsonb_build_array('owner_name'),
                    'person_name', jsonb_build_array('owner_name'),
                    'address', jsonb_build_array('address', 'site_address'),
                    'city', jsonb_build_array('city'),
                    'state', jsonb_build_array('state'),
                    'postcode', jsonb_build_array('postcode'),
                    'record_id', jsonb_build_array('record_id', 'folio'),
                    'status', jsonb_build_array('status'),
                    'record_type', jsonb_build_array('record_type'),
                    'additional_match_name', jsonb_build_array('owner_business_name', 'property_owner_1', 'property_owner_2', 'property_owner_3')
                )
            )
        ),
        (
            'property.fl.hillsborough_appraiser',
            'Hillsborough property appraiser',
            'property_records',
            2,
            1,
            2,
            'public_api',
            650,
            '{"states":["FL"],"cities":["tampa","brandon","riverview","plant city","temple terrace","valrico","seffner","apollo beach","lutz","ruskin","gibsonton","lithia","thonotosassa","wimauma","sun city center","odessa","carrollwood"],"industries":["all_enabled"]}'::jsonb,
            jsonb_build_object(
                'adapter', 'fl_county_property_appraiser',
                'county_source', 'hillsborough_property_appraiser',
                'source_url', 'https://gis.hcpafl.org/propertysearch/',
                'provenance_url', 'https://gis.hcpafl.org/propertysearch/',
                'claim_profile', 'florida_county_property_appraiser_parcel_corroboration',
                'identity_claim_kind', 'owner_identity',
                'person_role', 'parcel_owner_after_strict_address_or_entity_match',
                'query_limit', 5,
                'search_term_limit', 4,
                'owner_identity_points_on_match', 1,
                'owner_phone_points_on_match', 0,
                'business_support_points_on_match', 2,
                'source_role', 'county_property_appraiser_owner_identity_cautious',
                'pass', 'owner_identity_v5_4_11_fl_county_records',
                'caution', 'Parcel owners can be landlords, customers, trusts, or related entities. Owner names are only recorded after a strict address/entity match and real-person gate.',
                'field_map', jsonb_build_object(
                    'business_name', jsonb_build_array('business_name', 'owner_business_name'),
                    'owner_name', jsonb_build_array('owner_name'),
                    'person_name', jsonb_build_array('owner_name'),
                    'address', jsonb_build_array('address', 'site_address'),
                    'city', jsonb_build_array('city'),
                    'state', jsonb_build_array('state'),
                    'postcode', jsonb_build_array('postcode'),
                    'record_id', jsonb_build_array('record_id', 'folio', 'pin'),
                    'status', jsonb_build_array('status', 'land_use'),
                    'record_type', jsonb_build_array('record_type'),
                    'additional_match_name', jsonb_build_array('owner_business_name')
                )
            )
        ),
        (
            'clerk.fl.hillsborough_official_records',
            'Hillsborough clerk official records',
            'official_records',
            2,
            1,
            2,
            'public_api',
            900,
            '{"states":["FL"],"cities":["tampa","brandon","riverview","plant city","temple terrace","valrico","seffner","apollo beach","lutz","ruskin","gibsonton","lithia","thonotosassa","wimauma","sun city center","odessa","carrollwood"],"industries":["all_enabled"]}'::jsonb,
            jsonb_build_object(
                'adapter', 'hillsborough_clerk_official_records',
                'county_source', 'hillsborough_clerk_official_records',
                'source_url', 'https://publicaccess.hillsclerk.com/oripublicaccess/',
                'provenance_url', 'https://publicaccess.hillsclerk.com/oripublicaccess/',
                'claim_profile', 'hillsborough_clerk_notice_of_commencement_corroboration',
                'identity_claim_kind', 'owner_identity',
                'person_role', 'matched_party_dba_owner_only',
                'doc_types', jsonb_build_array('(NOC) NOTICE OF COMMENCEMENT'),
                'lookback_months', 24,
                'query_limit', 10,
                'search_term_limit', 4,
                'owner_identity_points_on_match', 1,
                'owner_phone_points_on_match', 0,
                'business_support_points_on_match', 2,
                'source_role', 'official_records_business_activity_corroboration',
                'pass', 'owner_identity_v5_4_11_fl_county_records',
                'caution', 'Notice-of-commencement parties are often customers, contractors, lenders, and owners of job sites. The adapter only extracts an owner name from a matched DBA party.',
                'field_map', jsonb_build_object(
                    'business_name', jsonb_build_array('business_name', 'matched_party'),
                    'owner_name', jsonb_build_array('owner_name'),
                    'person_name', jsonb_build_array('owner_name'),
                    'address', jsonb_build_array('address'),
                    'record_id', jsonb_build_array('record_id'),
                    'status', jsonb_build_array('status'),
                    'record_type', jsonb_build_array('record_type'),
                    'additional_match_name', jsonb_build_array('party_one', 'party_two', 'matched_party')
                )
            )
        )
)
insert into public.leadgen_source_catalog (
    source_key, label, family, source_points, owner_identity_points, owner_phone_points, business_support_points,
    access_method, free_status, implementation_status, run_stage, enabled, rate_limit_ms, coverage, metadata
)
select source_key,
    label,
    family,
    source_points,
    owner_identity_points,
    0,
    business_support_points,
    access_method,
    'free',
    'active',
    'candidate_investigation',
    true,
    rate_limit_ms,
    coverage,
    metadata
from source_rows
on conflict (source_key)
do update set label = excluded.label,
    family = excluded.family,
    source_points = excluded.source_points,
    owner_identity_points = excluded.owner_identity_points,
    owner_phone_points = 0,
    business_support_points = excluded.business_support_points,
    access_method = excluded.access_method,
    free_status = 'free',
    implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    rate_limit_ms = excluded.rate_limit_ms,
    coverage = excluded.coverage,
    metadata = coalesce(public.leadgen_source_catalog.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with capabilities(source_key, stage_key, priority, reason) as (
    values
        ('property.fl.miamidade_appraiser', 'business_validation', 56, 'miami_dade_property_parcel_business_corroboration'),
        ('property.fl.miamidade_appraiser', 'owner_identity', 57, 'miami_dade_property_parcel_owner_cautious'),
        ('property.fl.hillsborough_appraiser', 'business_validation', 56, 'hillsborough_property_parcel_business_corroboration'),
        ('property.fl.hillsborough_appraiser', 'owner_identity', 57, 'hillsborough_property_parcel_owner_cautious'),
        ('clerk.fl.hillsborough_official_records', 'business_validation', 63, 'hillsborough_clerk_record_activity_corroboration'),
        ('clerk.fl.hillsborough_official_records', 'owner_identity', 86, 'hillsborough_clerk_dba_owner_cautious_only')
)
insert into public.leadgen_source_stage_capabilities (source_key, stage_key, priority, metadata, enabled)
select source_key,
    stage_key,
    priority,
    jsonb_build_object('reason', reason, 'pass', 'owner_identity_v5_4_11_fl_county_records'),
    true
from capabilities
on conflict (source_key, stage_key)
do update set enabled = true,
    priority = excluded.priority,
    metadata = coalesce(public.leadgen_source_stage_capabilities.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

update public.leadgen_source_catalog source
set stage_capabilities = coalesce((
        select jsonb_agg(jsonb_build_object('stage_key', stage_key, 'priority', priority) order by priority, stage_key)
        from public.leadgen_source_stage_capabilities capabilities
        where capabilities.source_key = source.source_key
        and capabilities.enabled = true
    ), '[]'::jsonb),
    updated_at = now()
where source.source_key in (
    'property.fl.miamidade_appraiser',
    'property.fl.hillsborough_appraiser',
    'clerk.fl.hillsborough_official_records'
);

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata, enabled)
select source.source_key,
    industry.value,
    array[industry.value],
    industry.label,
    jsonb_build_object(
        'seed', 'leadgen_v5_4_11_fl_county_records',
        'state', 'FL',
        'mapping_mode', 'county_record_all_enabled_industries'
    ),
    true
from (values
    ('property.fl.miamidade_appraiser'),
    ('property.fl.hillsborough_appraiser'),
    ('clerk.fl.hillsborough_official_records')
) as source(source_key)
cross join public.leadgen_icp_industries industry
where industry.enabled = true
on conflict (source_key, icp_industry_value)
do update set native_values = excluded.native_values,
    native_label = excluded.native_label,
    enabled = true,
    metadata = coalesce(public.leadgen_source_industry_mappings.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with fl_locations as (
    select value,
        label,
        lower(coalesce(locality, value)) as locality_key,
        lower(coalesce(region, '')) as region_key,
        lower(coalesce(metadata::text, '')) as metadata_key
    from public.leadgen_icp_locations
    where enabled = true
    and country = 'US'
    and upper(region) = 'FL'
),
source_location_targets as (
    select 'property.fl.miamidade_appraiser'::text as source_key,
        value,
        label,
        'miami_dade_property_appraiser_relevant_locations'::text as mapping_mode
    from fl_locations
    where value = 'florida'
    or value = 'miami_fl'
    or locality_key like '%miami%'
    or metadata_key like '%miami-dade%'
    or metadata_key like '%miami dade%'
    union all
    select 'property.fl.hillsborough_appraiser'::text,
        value,
        label,
        'hillsborough_property_appraiser_relevant_locations'::text
    from fl_locations
    where value = 'florida'
    or value = 'tampa_fl'
    or locality_key in ('tampa', 'brandon', 'riverview', 'plant city', 'temple terrace', 'valrico', 'seffner', 'apollo beach', 'lutz', 'ruskin', 'gibsonton', 'lithia', 'thonotosassa', 'wimauma', 'sun city center', 'odessa', 'carrollwood')
    or metadata_key like '%hillsborough%'
    union all
    select 'clerk.fl.hillsborough_official_records'::text,
        value,
        label,
        'hillsborough_clerk_relevant_locations'::text
    from fl_locations
    where value = 'florida'
    or value = 'tampa_fl'
    or locality_key in ('tampa', 'brandon', 'riverview', 'plant city', 'temple terrace', 'valrico', 'seffner', 'apollo beach', 'lutz', 'ruskin', 'gibsonton', 'lithia', 'thonotosassa', 'wimauma', 'sun city center', 'odessa', 'carrollwood')
    or metadata_key like '%hillsborough%'
)
insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata, enabled)
select source_key,
    value,
    array[label],
    jsonb_build_object(
        'seed', 'leadgen_v5_4_11_fl_county_records',
        'state', 'FL',
        'mapping_mode', mapping_mode
    ),
    true
from source_location_targets
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = coalesce(public.leadgen_source_location_mappings.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_health (source_key, status, last_error, metadata)
values
    (
        'property.fl.miamidade_appraiser',
        'unknown',
        null,
        '{"adapter_seeded_by":"20260707183000_leadgen_v5411_fl_county_records","lookup_mode":"county_property_appraiser_public_api"}'::jsonb
    ),
    (
        'property.fl.hillsborough_appraiser',
        'unknown',
        null,
        '{"adapter_seeded_by":"20260707183000_leadgen_v5411_fl_county_records","lookup_mode":"county_property_appraiser_public_api"}'::jsonb
    ),
    (
        'clerk.fl.hillsborough_official_records',
        'unknown',
        null,
        '{"adapter_seeded_by":"20260707183000_leadgen_v5411_fl_county_records","lookup_mode":"county_clerk_official_records_public_api"}'::jsonb
    )
on conflict (source_key) do update set
    status = excluded.status,
    last_error = excluded.last_error,
    metadata = coalesce(public.leadgen_source_health.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with default_sources(source_key) as (
    values
        ('property.fl.miamidade_appraiser'),
        ('property.fl.hillsborough_appraiser'),
        ('clerk.fl.hillsborough_official_records')
),
expanded_settings as (
    select settings.workspace_id, jsonb_array_elements_text(settings.enabled_sources) as source_key
    from public.leadgen_workspace_settings settings
    union
    select settings.workspace_id, default_sources.source_key
    from public.leadgen_workspace_settings settings
    cross join default_sources
),
aggregated_settings as (
    select workspace_id, jsonb_agg(source_key order by source_key) as enabled_sources
    from (
        select distinct workspace_id, source_key
        from expanded_settings
        where source_key is not null and source_key <> ''
    ) deduped_settings
    group by workspace_id
)
update public.leadgen_workspace_settings settings
set enabled_sources = aggregated_settings.enabled_sources,
    updated_at = now()
from aggregated_settings
where settings.workspace_id = aggregated_settings.workspace_id;
