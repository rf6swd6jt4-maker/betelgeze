with v1_locations(value, label, location_kind, country, region, locality, latitude, longitude, radius_meters) as (
    values
        ('texas', 'Texas', 'state', 'US', 'TX', null, 31.9686::double precision, -99.9018::double precision, 40000),
        ('florida', 'Florida', 'state', 'US', 'FL', null, 27.6648::double precision, -81.5158::double precision, 40000),
        ('california', 'California', 'state', 'US', 'CA', null, 36.7783::double precision, -119.4179::double precision, 40000),
        ('arizona', 'Arizona', 'state', 'US', 'AZ', null, 34.0489::double precision, -111.0937::double precision, 40000),
        ('dallas_tx', 'Dallas, TX', 'city', 'US', 'TX', 'Dallas', 32.7767::double precision, -96.7970::double precision, 24000),
        ('fort_worth_tx', 'Fort Worth, TX', 'city', 'US', 'TX', 'Fort Worth', 32.7555::double precision, -97.3308::double precision, 24000),
        ('dfw_tx', 'Dallas-Fort Worth, TX', 'metro', 'US', 'TX', 'Dallas-Fort Worth', 32.8998::double precision, -97.0403::double precision, 40000),
        ('austin_tx', 'Austin, TX', 'city', 'US', 'TX', 'Austin', 30.2672::double precision, -97.7431::double precision, 24000),
        ('houston_tx', 'Houston, TX', 'city', 'US', 'TX', 'Houston', 29.7604::double precision, -95.3698::double precision, 24000),
        ('greater_houston_tx', 'Greater Houston, TX', 'metro', 'US', 'TX', 'Houston', 29.7604::double precision, -95.3698::double precision, 40000),
        ('san_antonio_tx', 'San Antonio, TX', 'city', 'US', 'TX', 'San Antonio', 29.4241::double precision, -98.4936::double precision, 24000),
        ('miami_fl', 'Miami, FL', 'city', 'US', 'FL', 'Miami', 25.7617::double precision, -80.1918::double precision, 24000),
        ('orlando_fl', 'Orlando, FL', 'city', 'US', 'FL', 'Orlando', 28.5383::double precision, -81.3792::double precision, 24000),
        ('tampa_fl', 'Tampa, FL', 'city', 'US', 'FL', 'Tampa', 27.9506::double precision, -82.4572::double precision, 24000),
        ('jacksonville_fl', 'Jacksonville, FL', 'city', 'US', 'FL', 'Jacksonville', 30.3322::double precision, -81.6557::double precision, 24000),
        ('los_angeles_ca', 'Los Angeles, CA', 'city', 'US', 'CA', 'Los Angeles', 34.0522::double precision, -118.2437::double precision, 24000),
        ('san_diego_ca', 'San Diego, CA', 'city', 'US', 'CA', 'San Diego', 32.7157::double precision, -117.1611::double precision, 24000),
        ('bay_area_ca', 'Bay Area, CA', 'metro', 'US', 'CA', 'San Francisco Bay Area', 37.7749::double precision, -122.4194::double precision, 40000),
        ('phoenix_az', 'Phoenix, AZ', 'city', 'US', 'AZ', 'Phoenix', 33.4484::double precision, -112.0740::double precision, 24000),
        ('tucson_az', 'Tucson, AZ', 'city', 'US', 'AZ', 'Tucson', 32.2226::double precision, -110.9747::double precision, 24000)
)
insert into public.leadgen_icp_locations (value, label, location_kind, country, region, locality, latitude, longitude, radius_meters, metadata)
select value,
    label,
    location_kind,
    country,
    region,
    locality,
    latitude,
    longitude,
    radius_meters,
    jsonb_build_object('seed', 'leadgen_v1_seed_coverage_and_locations', 'target_v1', true)
from v1_locations
on conflict (value)
do update set label = excluded.label,
    location_kind = excluded.location_kind,
    country = excluded.country,
    region = excluded.region,
    locality = excluded.locality,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    radius_meters = excluded.radius_meters,
    enabled = true,
    metadata = public.leadgen_icp_locations.metadata || excluded.metadata,
    updated_at = now();

with v1_locations(value, label, location_kind, country, region, locality, latitude, longitude, radius_meters) as (
    values
        ('texas', 'Texas', 'state', 'US', 'TX', null, 31.9686::double precision, -99.9018::double precision, 40000),
        ('florida', 'Florida', 'state', 'US', 'FL', null, 27.6648::double precision, -81.5158::double precision, 40000),
        ('california', 'California', 'state', 'US', 'CA', null, 36.7783::double precision, -119.4179::double precision, 40000),
        ('arizona', 'Arizona', 'state', 'US', 'AZ', null, 34.0489::double precision, -111.0937::double precision, 40000),
        ('dallas_tx', 'Dallas, TX', 'city', 'US', 'TX', 'Dallas', 32.7767::double precision, -96.7970::double precision, 24000),
        ('fort_worth_tx', 'Fort Worth, TX', 'city', 'US', 'TX', 'Fort Worth', 32.7555::double precision, -97.3308::double precision, 24000),
        ('dfw_tx', 'Dallas-Fort Worth, TX', 'metro', 'US', 'TX', 'Dallas-Fort Worth', 32.8998::double precision, -97.0403::double precision, 40000),
        ('austin_tx', 'Austin, TX', 'city', 'US', 'TX', 'Austin', 30.2672::double precision, -97.7431::double precision, 24000),
        ('houston_tx', 'Houston, TX', 'city', 'US', 'TX', 'Houston', 29.7604::double precision, -95.3698::double precision, 24000),
        ('greater_houston_tx', 'Greater Houston, TX', 'metro', 'US', 'TX', 'Houston', 29.7604::double precision, -95.3698::double precision, 40000),
        ('san_antonio_tx', 'San Antonio, TX', 'city', 'US', 'TX', 'San Antonio', 29.4241::double precision, -98.4936::double precision, 24000),
        ('miami_fl', 'Miami, FL', 'city', 'US', 'FL', 'Miami', 25.7617::double precision, -80.1918::double precision, 24000),
        ('orlando_fl', 'Orlando, FL', 'city', 'US', 'FL', 'Orlando', 28.5383::double precision, -81.3792::double precision, 24000),
        ('tampa_fl', 'Tampa, FL', 'city', 'US', 'FL', 'Tampa', 27.9506::double precision, -82.4572::double precision, 24000),
        ('jacksonville_fl', 'Jacksonville, FL', 'city', 'US', 'FL', 'Jacksonville', 30.3322::double precision, -81.6557::double precision, 24000),
        ('los_angeles_ca', 'Los Angeles, CA', 'city', 'US', 'CA', 'Los Angeles', 34.0522::double precision, -118.2437::double precision, 24000),
        ('san_diego_ca', 'San Diego, CA', 'city', 'US', 'CA', 'San Diego', 32.7157::double precision, -117.1611::double precision, 24000),
        ('bay_area_ca', 'Bay Area, CA', 'metro', 'US', 'CA', 'San Francisco Bay Area', 37.7749::double precision, -122.4194::double precision, 40000),
        ('phoenix_az', 'Phoenix, AZ', 'city', 'US', 'AZ', 'Phoenix', 33.4484::double precision, -112.0740::double precision, 24000),
        ('tucson_az', 'Tucson, AZ', 'city', 'US', 'AZ', 'Tucson', 32.2226::double precision, -110.9747::double precision, 24000)
)
insert into public.leadgen_geo_targets (value, label, country, region, locality, latitude, longitude, radius_meters, metadata)
select value,
    label,
    country,
    region,
    locality,
    latitude,
    longitude,
    radius_meters,
    jsonb_build_object('seed', 'leadgen_v1_seed_coverage_and_locations', 'target_v1', true, 'location_kind', location_kind)
from v1_locations
on conflict (value)
do update set label = excluded.label,
    country = excluded.country,
    region = excluded.region,
    locality = excluded.locality,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    radius_meters = excluded.radius_meters,
    enabled = true,
    metadata = public.leadgen_geo_targets.metadata || excluded.metadata,
    updated_at = now();

with v1_locations(value) as (
    values
        ('texas'), ('florida'), ('california'), ('arizona'),
        ('dallas_tx'), ('fort_worth_tx'), ('dfw_tx'), ('austin_tx'), ('houston_tx'), ('greater_houston_tx'), ('san_antonio_tx'),
        ('miami_fl'), ('orlando_fl'), ('tampa_fl'), ('jacksonville_fl'),
        ('los_angeles_ca'), ('san_diego_ca'), ('bay_area_ca'),
        ('phoenix_az'), ('tucson_az')
)
update public.leadgen_icp_locations location
set enabled = location.value in (select value from v1_locations),
    metadata = case
        when location.value in (select value from v1_locations) then location.metadata || '{"target_v1":true}'::jsonb
        else location.metadata || '{"target_v1":false,"disabled_reason":"outside_v1_pilot_states"}'::jsonb
    end,
    updated_at = now()
where location.country = 'US';

with v1_locations(value) as (
    values
        ('texas'), ('florida'), ('california'), ('arizona'),
        ('dallas_tx'), ('fort_worth_tx'), ('dfw_tx'), ('austin_tx'), ('houston_tx'), ('greater_houston_tx'), ('san_antonio_tx'),
        ('miami_fl'), ('orlando_fl'), ('tampa_fl'), ('jacksonville_fl'),
        ('los_angeles_ca'), ('san_diego_ca'), ('bay_area_ca'),
        ('phoenix_az'), ('tucson_az')
),
cleaned as (
    select settings.workspace_id,
        coalesce((
            select jsonb_agg(current_location.value order by current_location.value)
            from jsonb_array_elements_text(coalesce(settings.source_config #> '{icp,locations}', '[]'::jsonb)) as current_location(value)
            join v1_locations on v1_locations.value = current_location.value
        ), '[]'::jsonb) as next_locations
    from public.leadgen_workspace_settings settings
)
update public.leadgen_workspace_settings settings
set source_config = jsonb_set(coalesce(settings.source_config, '{}'::jsonb) || '{"icp":{}}'::jsonb, '{icp,locations}', cleaned.next_locations, true),
    updated_at = now()
from cleaned
where settings.workspace_id = cleaned.workspace_id
and coalesce(settings.source_config #> '{icp,locations}', '[]'::jsonb) <> cleaned.next_locations;

insert into public.leadgen_geo_targets (value, label, country, region, locality, latitude, longitude, radius_meters, metadata)
values
    ('san_francisco_ca', 'San Francisco, CA', 'US', 'CA', 'San Francisco', 37.7749, -122.4194, 24000, '{"seed":"leadgen_v1_seed_coverage","target_v1_native":true}'::jsonb),
    ('oakland_ca', 'Oakland, CA', 'US', 'CA', 'Oakland', 37.8044, -122.2712, 24000, '{"seed":"leadgen_v1_seed_coverage","target_v1_native":true}'::jsonb),
    ('san_jose_ca', 'San Jose, CA', 'US', 'CA', 'San Jose', 37.3382, -121.8863, 24000, '{"seed":"leadgen_v1_seed_coverage","target_v1_native":true}'::jsonb)
on conflict (value)
do update set label = excluded.label,
    country = excluded.country,
    region = excluded.region,
    locality = excluded.locality,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    radius_meters = excluded.radius_meters,
    enabled = true,
    metadata = public.leadgen_geo_targets.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
values
    ('overture', 'cleaning_companies', array['cleaning_service','house_cleaning_service','commercial_cleaning_service','janitorial_service'], 'Overture cleaning companies', '{"seed":"leadgen_v1_seed_coverage","mapping_mode":"overture_category_alias"}'::jsonb),
    ('overture', 'pest_control', array['pest_control_service','exterminator'], 'Overture pest control', '{"seed":"leadgen_v1_seed_coverage","mapping_mode":"overture_category_alias"}'::jsonb),
    ('overture', 'lighting_contractors', array['lighting_contractor','electrician','electrical_contractor','lighting_store'], 'Overture lighting contractors', '{"seed":"leadgen_v1_seed_coverage","mapping_mode":"overture_category_alias"}'::jsonb),
    ('overture', 'auto_repair', array['auto_repair_shop','car_repair','auto_body_shop','mechanic'], 'Overture auto repair', '{"seed":"leadgen_v1_seed_coverage","mapping_mode":"overture_category_alias"}'::jsonb),
    ('overture', 'waste_disposal', array['waste_management_service','garbage_collection_service','junk_removal_service','recycling_center'], 'Overture waste disposal', '{"seed":"leadgen_v1_seed_coverage","mapping_mode":"overture_category_alias"}'::jsonb)
on conflict (source_key, icp_industry_value)
do update set native_values = excluded.native_values,
    native_label = excluded.native_label,
    enabled = true,
    metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
values
    ('osm', 'cleaning_companies', array['shop=cleaning','office=cleaning','craft=cleaning'], 'OSM cleaning companies', '{"seed":"leadgen_v1_seed_coverage","osm_tags":["shop=cleaning","office=cleaning","craft=cleaning"]}'::jsonb),
    ('osm', 'pest_control', array['shop=pest_control','craft=pest_control','office=pest_control'], 'OSM pest control', '{"seed":"leadgen_v1_seed_coverage","osm_tags":["shop=pest_control","craft=pest_control","office=pest_control"]}'::jsonb),
    ('osm', 'lighting_contractors', array['shop=lighting','craft=electrician'], 'OSM lighting contractors', '{"seed":"leadgen_v1_seed_coverage","osm_tags":["shop=lighting","craft=electrician"]}'::jsonb),
    ('osm', 'auto_repair', array['shop=car_repair','shop=car','craft=mechanic'], 'OSM auto repair', '{"seed":"leadgen_v1_seed_coverage","osm_tags":["shop=car_repair","shop=car","craft=mechanic"]}'::jsonb),
    ('osm', 'waste_disposal', array['amenity=recycling','shop=waste_disposal','office=waste_management'], 'OSM waste disposal', '{"seed":"leadgen_v1_seed_coverage","osm_tags":["amenity=recycling","shop=waste_disposal","office=waste_management"]}'::jsonb)
on conflict (source_key, icp_industry_value)
do update set native_values = excluded.native_values,
    native_label = excluded.native_label,
    enabled = true,
    metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select source.source_key,
    industry.value,
    array[industry.value, lower(replace(industry.label, ' ', '_'))],
    industry.label,
    jsonb_build_object('seed', 'leadgen_v1_seed_coverage', 'category', industry.category)
from (values ('alltheplaces'), ('foursquare_os_places'), ('website'), ('sam_gov')) as source(source_key)
cross join public.leadgen_icp_industries industry
where industry.enabled = true
and coalesce((industry.metadata ->> 'target_v1')::boolean, false) = true
on conflict (source_key, icp_industry_value)
do update set native_values = excluded.native_values,
    native_label = excluded.native_label,
    enabled = true,
    metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata,
    updated_at = now();

with v1_locations as (
    select value, label, country, region, locality, latitude, longitude, radius_meters, location_kind
    from public.leadgen_icp_locations
    where enabled = true
    and coalesce((metadata ->> 'target_v1')::boolean, false) = true
)
insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
select source.source_key,
    location.value,
    array[location.value],
    jsonb_build_object(
        'seed', 'leadgen_v1_seed_coverage',
        'country', location.country,
        'region', location.region,
        'locality', location.locality,
        'location_kind', location.location_kind,
        'latitude', location.latitude,
        'longitude', location.longitude,
        'radius_meters', location.radius_meters
    )
from (values ('overture'), ('alltheplaces'), ('foursquare_os_places')) as source(source_key)
cross join v1_locations location
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
values
    ('osm', 'texas', array['dallas_tx','fort_worth_tx','austin_tx','houston_tx','san_antonio_tx'], '{"seed":"leadgen_v1_seed_coverage","source":"state_to_city_seed"}'::jsonb),
    ('osm', 'florida', array['jacksonville_fl','miami_fl','orlando_fl','tampa_fl'], '{"seed":"leadgen_v1_seed_coverage","source":"state_to_city_seed"}'::jsonb),
    ('osm', 'california', array['los_angeles_ca','san_diego_ca','san_francisco_ca','oakland_ca','san_jose_ca'], '{"seed":"leadgen_v1_seed_coverage","source":"state_to_city_seed"}'::jsonb),
    ('osm', 'arizona', array['phoenix_az','tucson_az'], '{"seed":"leadgen_v1_seed_coverage","source":"state_to_city_seed"}'::jsonb),
    ('osm', 'dfw_tx', array['dallas_tx','fort_worth_tx'], '{"seed":"leadgen_v1_seed_coverage","source":"metro_to_city_seed"}'::jsonb),
    ('osm', 'greater_houston_tx', array['houston_tx'], '{"seed":"leadgen_v1_seed_coverage","source":"metro_to_city_seed"}'::jsonb),
    ('osm', 'bay_area_ca', array['san_francisco_ca','oakland_ca','san_jose_ca'], '{"seed":"leadgen_v1_seed_coverage","source":"metro_to_city_seed"}'::jsonb),
    ('osm', 'dallas_tx', array['dallas_tx'], '{"seed":"leadgen_v1_seed_coverage","source":"city_self"}'::jsonb),
    ('osm', 'fort_worth_tx', array['fort_worth_tx'], '{"seed":"leadgen_v1_seed_coverage","source":"city_self"}'::jsonb),
    ('osm', 'austin_tx', array['austin_tx'], '{"seed":"leadgen_v1_seed_coverage","source":"city_self"}'::jsonb),
    ('osm', 'houston_tx', array['houston_tx'], '{"seed":"leadgen_v1_seed_coverage","source":"city_self"}'::jsonb),
    ('osm', 'san_antonio_tx', array['san_antonio_tx'], '{"seed":"leadgen_v1_seed_coverage","source":"city_self"}'::jsonb),
    ('osm', 'miami_fl', array['miami_fl'], '{"seed":"leadgen_v1_seed_coverage","source":"city_self"}'::jsonb),
    ('osm', 'orlando_fl', array['orlando_fl'], '{"seed":"leadgen_v1_seed_coverage","source":"city_self"}'::jsonb),
    ('osm', 'tampa_fl', array['tampa_fl'], '{"seed":"leadgen_v1_seed_coverage","source":"city_self"}'::jsonb),
    ('osm', 'jacksonville_fl', array['jacksonville_fl'], '{"seed":"leadgen_v1_seed_coverage","source":"city_self"}'::jsonb),
    ('osm', 'los_angeles_ca', array['los_angeles_ca'], '{"seed":"leadgen_v1_seed_coverage","source":"city_self"}'::jsonb),
    ('osm', 'san_diego_ca', array['san_diego_ca'], '{"seed":"leadgen_v1_seed_coverage","source":"city_self"}'::jsonb),
    ('osm', 'phoenix_az', array['phoenix_az'], '{"seed":"leadgen_v1_seed_coverage","source":"city_self"}'::jsonb),
    ('osm', 'tucson_az', array['tucson_az'], '{"seed":"leadgen_v1_seed_coverage","source":"city_self"}'::jsonb)
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata,
    updated_at = now();
