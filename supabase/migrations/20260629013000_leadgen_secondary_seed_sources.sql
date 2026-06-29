insert into public.leadgen_source_catalog (
    source_key,
    label,
    family,
    source_points,
    owner_identity_points,
    owner_phone_points,
    business_support_points,
    access_method,
    free_status,
    implementation_status,
    run_stage,
    enabled,
    rate_limit_ms,
    coverage,
    metadata
) values
    (
        'osm',
        'OpenStreetMap raw data',
        'seed',
        1,
        0,
        0,
        1,
        'public_api',
        'free',
        'active',
        'seed',
        true,
        3000,
        '{"countries":["US"]}'::jsonb,
        '{"adapter":"overpass_seed_worker","quota_note":"public Overpass endpoints are used conservatively with small mapped tasks"}'::jsonb
    ),
    (
        'alltheplaces',
        'AllThePlaces',
        'seed',
        1,
        0,
        0,
        1,
        'public_zip_range',
        'free',
        'active',
        'seed',
        true,
        0,
        '{"countries":["US"]}'::jsonb,
        '{"adapter":"alltheplaces_zip_range","archive":"https://data.alltheplaces.xyz/runs/history.json","download_strategy":"central_directory_plus_small_matching_geojson_entries"}'::jsonb
    ),
    (
        'foursquare_os_places',
        'Foursquare OS Places',
        'seed',
        1,
        0,
        0,
        1,
        'public_pmtiles_url',
        'free',
        'active',
        'seed',
        true,
        0,
        '{"countries":["US"]}'::jsonb,
        '{"adapter":"foursquare_os_places_pmtiles","required_env":"FOURSQUARE_OS_PLACES_PMTILES_URL","note":"Requires a byte-range-readable PMTiles URL from Foursquare Places Portal or an accessible mirror."}'::jsonb
    ),
    (
        'state_license.fl.electrical',
        'Florida DBPR electrical records',
        'licensing',
        3,
        3,
        3,
        2,
        'public_csv',
        'free',
        'active',
        'candidate_investigation',
        true,
        1500,
        '{"states":["FL"],"industries":["electricians","solar_installers","pool_builders","hvac_contractors","general_contractors"]}'::jsonb,
        '{"adapter":"fl_dbpr_electrical_csv","provenance_url":"https://www2.myfloridalicense.com/sto/file_download/extracts/lic08el.csv"}'::jsonb
    ),
    (
        'state_license.nc.general_contractors',
        'North Carolina general contractor search',
        'licensing',
        3,
        3,
        3,
        2,
        'public_html',
        'free',
        'active',
        'candidate_investigation',
        true,
        1500,
        '{"states":["NC"],"industries":["general_contractors","remodellers","roofers","pool_builders","home_builders"]}'::jsonb,
        '{"adapter":"nc_general_contractors_search","provenance_url":"https://portal.nclbgc.org/Public/_Search/"}'::jsonb
    ),
    (
        'sam_gov',
        'SAM.gov Entity Management',
        'procurement',
        2,
        2,
        2,
        2,
        'public_api_key',
        'free_key',
        'active',
        'candidate_investigation',
        true,
        10000,
        '{"countries":["US"]}'::jsonb,
        '{"adapter":"sam_entity_information","required_env":"SAM_GOV_API_KEY","quota_policy":"one mapped task per poll"}'::jsonb
    )
on conflict (source_key) do update set
    label = excluded.label,
    family = excluded.family,
    source_points = excluded.source_points,
    owner_identity_points = excluded.owner_identity_points,
    owner_phone_points = excluded.owner_phone_points,
    business_support_points = excluded.business_support_points,
    access_method = excluded.access_method,
    free_status = excluded.free_status,
    implementation_status = excluded.implementation_status,
    run_stage = excluded.run_stage,
    enabled = excluded.enabled,
    rate_limit_ms = excluded.rate_limit_ms,
    coverage = excluded.coverage,
    metadata = public.leadgen_source_catalog.metadata || excluded.metadata,
    updated_at = now();

update public.leadgen_source_catalog
set label = 'Texas TDLR licensing',
    implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    metadata = metadata || '{"adapter":"tdlr_license_search","split_source":"state_license.tx.tdlr"}'::jsonb,
    updated_at = now()
where source_key = 'state_license.tx.tdlr';

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select seed_source.source_key,
       industry.value,
       array[industry.value, lower(regexp_replace(industry.label, '[^a-zA-Z0-9]+', '_', 'g'))],
       industry.label,
       jsonb_build_object('adapter', seed_source.source_key, 'status', 'mapping_seeded', 'terms_from', 'icp_value_and_label')
from public.leadgen_icp_industries industry
cross join (values ('alltheplaces'), ('foursquare_os_places')) as seed_source(source_key)
where industry.enabled = true
on conflict (source_key, icp_industry_value)
do update set native_values = excluded.native_values, native_label = excluded.native_label, enabled = true, metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata, updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
select seed_source.source_key,
       mapping.icp_location_value,
       mapping.native_values,
       mapping.metadata || jsonb_build_object('adapter', seed_source.source_key, 'status', 'mapping_seeded_from_overture')
from public.leadgen_source_location_mappings mapping
cross join (values ('alltheplaces'), ('foursquare_os_places')) as seed_source(source_key)
where mapping.source_key = 'overture'
and mapping.enabled = true
and cardinality(mapping.native_values) > 0
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values, enabled = true, metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata, updated_at = now();

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select 'state_license.tx.tdlr', icp_industry_value, native_values, native_label, metadata || '{"split_source":"state_license.tx.tdlr"}'::jsonb
from public.leadgen_source_industry_mappings
where source_key = 'state_licensing'
and enabled = true
and cardinality(native_values) > 0
on conflict (source_key, icp_industry_value)
do update set native_values = excluded.native_values, native_label = excluded.native_label, enabled = true, metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata, updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
select 'state_license.tx.tdlr', icp_location_value, native_values, metadata || '{"split_source":"state_license.tx.tdlr"}'::jsonb
from public.leadgen_source_location_mappings
where source_key = 'state_licensing'
and enabled = true
and cardinality(native_values) > 0
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values, enabled = true, metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata, updated_at = now();

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
values
    ('state_license.fl.electrical', 'electricians', array['electrical_contractor'], 'Florida DBPR electrical contractor records', '{"board":"fl_dbpr_electrical","state":"FL"}'::jsonb),
    ('state_license.fl.electrical', 'solar_installers', array['electrical_contractor'], 'Florida DBPR electrical contractor records', '{"board":"fl_dbpr_electrical","state":"FL"}'::jsonb),
    ('state_license.fl.electrical', 'pool_builders', array['electrical_contractor'], 'Florida DBPR electrical contractor records', '{"board":"fl_dbpr_electrical","state":"FL"}'::jsonb),
    ('state_license.fl.electrical', 'hvac_contractors', array['electrical_contractor'], 'Florida DBPR electrical contractor records', '{"board":"fl_dbpr_electrical","state":"FL"}'::jsonb),
    ('state_license.fl.electrical', 'general_contractors', array['electrical_contractor'], 'Florida DBPR electrical contractor records', '{"board":"fl_dbpr_electrical","state":"FL"}'::jsonb)
on conflict (source_key, icp_industry_value)
do update set native_values = excluded.native_values, native_label = excluded.native_label, enabled = true, metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata, updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
values
    ('state_license.fl.electrical', 'florida', array['FL'], '{"board":"fl_dbpr_electrical","state":"FL"}'::jsonb),
    ('state_license.fl.electrical', 'miami_fl', array['FL'], '{"board":"fl_dbpr_electrical","state":"FL"}'::jsonb),
    ('state_license.fl.electrical', 'orlando_fl', array['FL'], '{"board":"fl_dbpr_electrical","state":"FL"}'::jsonb),
    ('state_license.fl.electrical', 'tampa_fl', array['FL'], '{"board":"fl_dbpr_electrical","state":"FL"}'::jsonb),
    ('state_license.fl.electrical', 'jacksonville_fl', array['FL'], '{"board":"fl_dbpr_electrical","state":"FL"}'::jsonb)
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values, enabled = true, metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata, updated_at = now();

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
values
    ('state_license.nc.general_contractors', 'concrete_contractors', array['42'], 'NC concrete classification', '{"board":"nc_general_contractors","state":"NC"}'::jsonb),
    ('state_license.nc.general_contractors', 'deck_builders', array['27','28'], 'NC building classification', '{"board":"nc_general_contractors","state":"NC"}'::jsonb),
    ('state_license.nc.general_contractors', 'fencing_contractors', array['50'], 'NC fencing classification', '{"board":"nc_general_contractors","state":"NC"}'::jsonb),
    ('state_license.nc.general_contractors', 'general_contractors', array['27','28','26'], 'NC general contractor classifications', '{"board":"nc_general_contractors","state":"NC"}'::jsonb),
    ('state_license.nc.general_contractors', 'home_builders', array['27','28'], 'NC building classification', '{"board":"nc_general_contractors","state":"NC"}'::jsonb),
    ('state_license.nc.general_contractors', 'kitchen_remodelling', array['27','28','44'], 'NC remodel classifications', '{"board":"nc_general_contractors","state":"NC"}'::jsonb),
    ('state_license.nc.general_contractors', 'masonry_contractors', array['46'], 'NC masonry classification', '{"board":"nc_general_contractors","state":"NC"}'::jsonb),
    ('state_license.nc.general_contractors', 'pool_builders', array['51'], 'NC swimming pool classification', '{"board":"nc_general_contractors","state":"NC"}'::jsonb),
    ('state_license.nc.general_contractors', 'remodellers', array['27','28','44'], 'NC remodel classifications', '{"board":"nc_general_contractors","state":"NC"}'::jsonb),
    ('state_license.nc.general_contractors', 'restoration_companies', array['27','28','26'], 'NC building classifications', '{"board":"nc_general_contractors","state":"NC"}'::jsonb),
    ('state_license.nc.general_contractors', 'roofers', array['49'], 'NC roofing classification', '{"board":"nc_general_contractors","state":"NC"}'::jsonb),
    ('state_license.nc.general_contractors', 'siding_contractors', array['27','44'], 'NC siding/remodel classifications', '{"board":"nc_general_contractors","state":"NC"}'::jsonb),
    ('state_license.nc.general_contractors', 'window_and_door_contractors', array['27','44'], 'NC window/door classifications', '{"board":"nc_general_contractors","state":"NC"}'::jsonb)
on conflict (source_key, icp_industry_value)
do update set native_values = excluded.native_values, native_label = excluded.native_label, enabled = true, metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata, updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
values
    ('state_license.nc.general_contractors', 'north_carolina', array['NC'], '{"board":"nc_general_contractors","state":"NC"}'::jsonb),
    ('state_license.nc.general_contractors', 'charlotte_nc', array['NC'], '{"board":"nc_general_contractors","state":"NC"}'::jsonb),
    ('state_license.nc.general_contractors', 'raleigh_nc', array['NC'], '{"board":"nc_general_contractors","state":"NC"}'::jsonb)
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values, enabled = true, metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata, updated_at = now();

with expanded_settings as (
    select workspace_id, jsonb_array_elements_text(enabled_sources) as source_key
    from public.leadgen_workspace_settings
), normalized_settings as (
    select workspace_id, source_key
    from expanded_settings
    where source_key not in ('state_licensing', 'opencorporates')
    union
    select workspace_id, 'state_license.tx.tdlr'
    from expanded_settings
    where source_key = 'state_licensing'
    union
    select workspace_id, 'state_license.fl.electrical'
    from expanded_settings
    where source_key = 'state_licensing'
    union
    select workspace_id, 'state_license.nc.general_contractors'
    from expanded_settings
    where source_key = 'state_licensing'
), aggregated_settings as (
    select settings.workspace_id, coalesce(jsonb_agg(normalized_settings.source_key order by normalized_settings.source_key) filter (where normalized_settings.source_key is not null), '[]'::jsonb) as enabled_sources
    from public.leadgen_workspace_settings settings
    left join normalized_settings on normalized_settings.workspace_id = settings.workspace_id
    group by settings.workspace_id
)
update public.leadgen_workspace_settings settings
set enabled_sources = aggregated_settings.enabled_sources,
    updated_at = now()
from aggregated_settings
where settings.workspace_id = aggregated_settings.workspace_id;

insert into public.leadgen_source_health (source_key, status)
select source_key, 'unknown'
from public.leadgen_source_catalog
where source_key in ('osm', 'alltheplaces', 'foursquare_os_places', 'state_license.tx.tdlr', 'state_license.fl.electrical', 'state_license.nc.general_contractors', 'sam_gov')
on conflict (source_key) do nothing;
