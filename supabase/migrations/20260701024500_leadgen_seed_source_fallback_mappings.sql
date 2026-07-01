-- Ensure selectable ICP industries and locations always have runnable seed-source mappings.
-- Runtime code still prefers source-specific rows, but these rows keep the Sources UI and poll snapshots truthful.

with enabled_industries as (
    select value, label
    from public.leadgen_icp_industries
    where enabled = true
),
generic_seed_sources(source_key, fallback_values, native_label, metadata) as (
    values
        ('overture', array['contractor','building_contractor','construction_services']::text[], 'Fallback Overture contractor seed categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"broad_runtime_seed_fallback"}'::jsonb),
        ('osm', array['craft=builder','office=construction_company']::text[], 'Fallback OSM contractor tags', '{"seed":"seed_source_fallback_mappings","mapping_mode":"broad_runtime_seed_fallback","osm_tags":["craft=builder","office=construction_company"]}'::jsonb),
        ('alltheplaces', array['contractor','builder','construction','home']::text[], 'Fallback AllThePlaces seed terms', '{"seed":"seed_source_fallback_mappings","mapping_mode":"term_runtime_seed_fallback"}'::jsonb),
        ('foursquare_os_places', array['contractor','builder','construction','home']::text[], 'Fallback Foursquare OS Places seed terms', '{"seed":"seed_source_fallback_mappings","mapping_mode":"term_runtime_seed_fallback"}'::jsonb)
),
fallback_mappings as (
    select source.source_key,
        industry.value as icp_industry_value,
        array(
            select distinct term
            from unnest(
                source.fallback_values
                || array[industry.value, lower(regexp_replace(industry.label, '[^a-zA-Z0-9]+', '_', 'g'))]
                || regexp_split_to_array(industry.value, '_')
            ) as terms(term)
            where length(term) >= 3
        ) as native_values,
        source.native_label,
        source.metadata
    from enabled_industries industry
    cross join generic_seed_sources source
)
insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select source_key, icp_industry_value, native_values, native_label, metadata
from fallback_mappings
where cardinality(native_values) > 0
on conflict (source_key, icp_industry_value)
do update set native_values = (
        select array_agg(distinct value order by value)
        from unnest(public.leadgen_source_industry_mappings.native_values || excluded.native_values) as merged(value)
    ),
    native_label = coalesce(public.leadgen_source_industry_mappings.native_label, excluded.native_label),
    enabled = true,
    metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata,
    updated_at = now();

with specific_mappings(source_key, icp_industry_value, native_values, native_label, metadata) as (
    values
        ('overture', 'auto_repair', array['auto_repair_shop','car_repair','auto_body_shop','mechanic'], 'Overture auto repair fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"source_specific_fallback"}'::jsonb),
        ('overture', 'cleaning_companies', array['cleaning_service','house_cleaning_service','commercial_cleaning_service','janitorial_service'], 'Overture cleaning fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"source_specific_fallback"}'::jsonb),
        ('overture', 'deck_builders', array['contractor','building_contractor','construction_services'], 'Overture deck-builder fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"broad_trade_fallback"}'::jsonb),
        ('overture', 'electricians', array['electrician','electrical_contractor','lighting_contractor','contractor'], 'Overture electrician fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"source_specific_fallback"}'::jsonb),
        ('overture', 'fencing_contractors', array['fence_contractor','fence_supply_store','contractor','construction_services'], 'Overture fencing fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"source_specific_fallback"}'::jsonb),
        ('overture', 'flooring_contractors', array['flooring_contractors','flooring_store','contractor','construction_services'], 'Overture flooring fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"source_specific_fallback"}'::jsonb),
        ('overture', 'garage_door_companies', array['garage_door_supplier','door_supplier','contractor','building_contractor','construction_services'], 'Overture garage-door fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"broad_trade_fallback"}'::jsonb),
        ('overture', 'general_contractors', array['general_contractor','contractor','building_contractor','construction_company','construction_services'], 'Overture general-contractor fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"source_specific_fallback"}'::jsonb),
        ('overture', 'hvac_contractors', array['hvac_contractor','air_conditioning_contractor','heating_contractor','contractor','construction_services'], 'Overture HVAC fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"source_specific_fallback"}'::jsonb),
        ('overture', 'landscapers', array['landscaping','landscaper','landscape_architect','contractor'], 'Overture landscaping fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"source_specific_fallback"}'::jsonb),
        ('overture', 'lighting_contractors', array['lighting_contractor','electrician','electrical_contractor','lighting_store'], 'Overture lighting fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"source_specific_fallback"}'::jsonb),
        ('overture', 'painters', array['painting_contractor','painter','contractor','construction_services'], 'Overture painter fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"source_specific_fallback"}'::jsonb),
        ('overture', 'pest_control', array['pest_control_service','exterminator'], 'Overture pest-control fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"source_specific_fallback"}'::jsonb),
        ('overture', 'plumbers', array['plumber','plumbing','plumbing_service'], 'Overture plumbing fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"source_specific_fallback"}'::jsonb),
        ('overture', 'pool_builders', array['swimming_pool_contractor','pool_cleaning_service','contractor','construction_services'], 'Overture pool-builder fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"source_specific_fallback"}'::jsonb),
        ('overture', 'remodellers', array['remodeler','altering_and_remodeling_contractor','home_improvement_contractor','contractor','construction_services'], 'Overture remodeler fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"source_specific_fallback"}'::jsonb),
        ('overture', 'restoration_companies', array['water_damage_restoration_service','fire_damage_restoration_service','contractor','construction_services'], 'Overture restoration fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"source_specific_fallback"}'::jsonb),
        ('overture', 'roofers', array['roofing','roofing_contractor','roofer','ceiling_and_roofing_repair_and_service'], 'Overture roofing fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"source_specific_fallback"}'::jsonb),
        ('overture', 'tree_services', array['tree_service','arborist','landscaping','logging_contractor'], 'Overture tree-service fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"source_specific_fallback"}'::jsonb),
        ('overture', 'waste_disposal', array['waste_management_service','garbage_collection_service','junk_removal_service','recycling_center'], 'Overture waste fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"source_specific_fallback"}'::jsonb),
        ('overture', 'water_well_services', array['well_drilling_contractor','pump_supplier','contractor','construction_services'], 'Overture water-well fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"source_specific_fallback"}'::jsonb),
        ('overture', 'window_and_door_contractors', array['window_installation_service','door_supplier','contractor','building_contractor','construction_services'], 'Overture window-and-door fallback categories', '{"seed":"seed_source_fallback_mappings","mapping_mode":"source_specific_fallback"}'::jsonb),
        ('osm', 'auto_repair', array['shop=car_repair','shop=car','craft=mechanic'], 'OSM auto repair fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["shop=car_repair","shop=car","craft=mechanic"]}'::jsonb),
        ('osm', 'cleaning_companies', array['shop=cleaning','office=cleaning','craft=cleaning'], 'OSM cleaning fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["shop=cleaning","office=cleaning","craft=cleaning"]}'::jsonb),
        ('osm', 'deck_builders', array['craft=carpenter','craft=builder','office=construction_company'], 'OSM deck-builder fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["craft=carpenter","craft=builder","office=construction_company"]}'::jsonb),
        ('osm', 'electricians', array['craft=electrician','shop=electrical','shop=lighting'], 'OSM electrician fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["craft=electrician","shop=electrical","shop=lighting"]}'::jsonb),
        ('osm', 'fencing_contractors', array['craft=fence','shop=fence','craft=builder'], 'OSM fencing fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["craft=fence","shop=fence","craft=builder"]}'::jsonb),
        ('osm', 'flooring_contractors', array['shop=flooring','craft=floorer','craft=builder'], 'OSM flooring fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["shop=flooring","craft=floorer","craft=builder"]}'::jsonb),
        ('osm', 'garage_door_companies', array['shop=doors','craft=garage_door','craft=builder','office=construction_company'], 'OSM garage-door fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["shop=doors","craft=garage_door","craft=builder","office=construction_company"]}'::jsonb),
        ('osm', 'general_contractors', array['office=construction_company','craft=builder'], 'OSM general-contractor fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["office=construction_company","craft=builder"]}'::jsonb),
        ('osm', 'hvac_contractors', array['craft=hvac','craft=heating_engineer','craft=air_conditioning','office=construction_company'], 'OSM HVAC fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["craft=hvac","craft=heating_engineer","craft=air_conditioning","office=construction_company"]}'::jsonb),
        ('osm', 'landscapers', array['craft=landscaper','shop=garden_centre','shop=landscaping'], 'OSM landscaping fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["craft=landscaper","shop=garden_centre","shop=landscaping"]}'::jsonb),
        ('osm', 'lighting_contractors', array['shop=lighting','craft=electrician','shop=electrical'], 'OSM lighting fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["shop=lighting","craft=electrician","shop=electrical"]}'::jsonb),
        ('osm', 'painters', array['craft=painter','shop=paint','craft=builder'], 'OSM painter fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["craft=painter","shop=paint","craft=builder"]}'::jsonb),
        ('osm', 'pest_control', array['shop=pest_control','craft=pest_control','office=pest_control'], 'OSM pest-control fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["shop=pest_control","craft=pest_control","office=pest_control"]}'::jsonb),
        ('osm', 'plumbers', array['craft=plumber','shop=plumbing','office=plumber'], 'OSM plumbing fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["craft=plumber","shop=plumbing","office=plumber"]}'::jsonb),
        ('osm', 'pool_builders', array['shop=swimming_pool','craft=pool','craft=builder'], 'OSM pool-builder fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["shop=swimming_pool","craft=pool","craft=builder"]}'::jsonb),
        ('osm', 'remodellers', array['office=construction_company','craft=builder','craft=carpenter'], 'OSM remodeler fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["office=construction_company","craft=builder","craft=carpenter"]}'::jsonb),
        ('osm', 'restoration_companies', array['craft=builder','office=construction_company'], 'OSM restoration fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["craft=builder","office=construction_company"]}'::jsonb),
        ('osm', 'roofers', array['craft=roofer','craft=builder'], 'OSM roofing fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["craft=roofer","craft=builder"]}'::jsonb),
        ('osm', 'tree_services', array['craft=arborist','craft=landscaper','shop=garden_centre'], 'OSM tree-service fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["craft=arborist","craft=landscaper","shop=garden_centre"]}'::jsonb),
        ('osm', 'waste_disposal', array['amenity=recycling','shop=waste_disposal','office=waste_management'], 'OSM waste fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["amenity=recycling","shop=waste_disposal","office=waste_management"]}'::jsonb),
        ('osm', 'water_well_services', array['craft=well_drilling','shop=pump','craft=builder'], 'OSM water-well fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["craft=well_drilling","shop=pump","craft=builder"]}'::jsonb),
        ('osm', 'window_and_door_contractors', array['shop=windows','shop=doors','craft=glazier','craft=builder'], 'OSM window-and-door fallback tags', '{"seed":"seed_source_fallback_mappings","osm_tags":["shop=windows","shop=doors","craft=glazier","craft=builder"]}'::jsonb)
)
insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select mapping.source_key, mapping.icp_industry_value, mapping.native_values, mapping.native_label, mapping.metadata
from specific_mappings mapping
join public.leadgen_icp_industries industry on industry.value = mapping.icp_industry_value
where industry.enabled = true
on conflict (source_key, icp_industry_value)
do update set native_values = (
        select array_agg(distinct value order by value)
        from unnest(public.leadgen_source_industry_mappings.native_values || excluded.native_values) as merged(value)
    ),
    native_label = excluded.native_label,
    enabled = true,
    metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select source_key,
    industry_value,
    source_category_aliases,
    source_search_term,
    metadata || jsonb_build_object('seed', 'seed_source_fallback_mappings', 'osm_tags', source_category_aliases)
from public.leadgen_source_category_mappings
where source_key = 'osm'
and enabled = true
on conflict (source_key, icp_industry_value)
do update set native_values = (
        select array_agg(distinct value order by value)
        from unnest(public.leadgen_source_industry_mappings.native_values || excluded.native_values) as merged(value)
    ),
    native_label = coalesce(public.leadgen_source_industry_mappings.native_label, excluded.native_label),
    enabled = true,
    metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata,
    updated_at = now();

with seed_sources(source_key) as (
    values ('overture'), ('osm'), ('alltheplaces'), ('foursquare_os_places')
),
enabled_locations as (
    select value, label, location_kind, country, region, locality, latitude, longitude, radius_meters
    from public.leadgen_icp_locations
    where enabled = true
    and country = 'US'
)
insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
select source.source_key,
    location.value,
    array[location.value],
    jsonb_build_object(
        'seed', 'seed_source_fallback_mappings',
        'country', location.country,
        'region', location.region,
        'locality', location.locality,
        'location_kind', location.location_kind,
        'latitude', location.latitude,
        'longitude', location.longitude,
        'radius_meters', location.radius_meters
    )
from seed_sources source
cross join enabled_locations location
on conflict (source_key, icp_location_value)
do update set native_values = case
        when cardinality(public.leadgen_source_location_mappings.native_values) > 0 then public.leadgen_source_location_mappings.native_values
        else excluded.native_values
    end,
    enabled = true,
    metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata,
    updated_at = now();
