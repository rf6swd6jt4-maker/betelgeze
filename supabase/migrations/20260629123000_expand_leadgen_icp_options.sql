insert into public.leadgen_icp_industries (value, label, category, metadata)
values
    ('electricians', 'Electricians', 'home_services', '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('plumbers', 'Plumbers', 'home_services', '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('hvac_contractors', 'HVAC Contractors', 'home_services', '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('general_contractors', 'General Contractors', 'home_services', '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('roofers', 'Roofers', 'home_services', '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('remodellers', 'Remodellers', 'home_services', '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('home_builders', 'Home Builders', 'home_services', '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('pool_builders', 'Pool Builders', 'home_services', '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('solar_installers', 'Solar Installers', 'home_services', '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('water_well_services', 'Water Well Services', 'home_services', '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('excavation_contractors', 'Excavation Contractors', 'site_services', '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('moving_companies', 'Moving Companies', 'transport', '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('trucking_companies', 'Trucking Companies', 'transport', '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('freight_forwarders', 'Freight Forwarders', 'transport', '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('hauling_services', 'Hauling Services', 'transport', '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('dumpster_rental', 'Dumpster Rental', 'transport', '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('healthcare_providers', 'Healthcare Providers', 'healthcare', '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('medical_clinics', 'Medical Clinics', 'healthcare', '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('dental_practices', 'Dental Practices', 'healthcare', '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('therapy_practices', 'Therapy Practices', 'healthcare', '{"seed":"expand_leadgen_icp_options"}'::jsonb)
on conflict (value)
do update set label = excluded.label,
    category = excluded.category,
    enabled = true,
    metadata = public.leadgen_icp_industries.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_icp_locations (value, label, location_kind, country, region, locality, latitude, longitude, radius_meters, metadata)
values
    ('california', 'California', 'state', 'US', 'CA', null, 36.7783, -119.4179, 40000, '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('arizona', 'Arizona', 'state', 'US', 'AZ', null, 34.0489, -111.0937, 40000, '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('tennessee', 'Tennessee', 'state', 'US', 'TN', null, 35.5175, -86.5804, 40000, '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('georgia', 'Georgia', 'state', 'US', 'GA', null, 32.1656, -82.9001, 40000, '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('colorado', 'Colorado', 'state', 'US', 'CO', null, 39.5501, -105.7821, 40000, '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('los_angeles_ca', 'Los Angeles, CA', 'city', 'US', 'CA', 'Los Angeles', 34.0522, -118.2437, 24000, '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('san_diego_ca', 'San Diego, CA', 'city', 'US', 'CA', 'San Diego', 32.7157, -117.1611, 24000, '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('bay_area_ca', 'Bay Area, CA', 'metro', 'US', 'CA', 'San Francisco Bay Area', 37.7749, -122.4194, 40000, '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('phoenix_az', 'Phoenix, AZ', 'city', 'US', 'AZ', 'Phoenix', 33.4484, -112.0740, 24000, '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('tucson_az', 'Tucson, AZ', 'city', 'US', 'AZ', 'Tucson', 32.2226, -110.9747, 24000, '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('atlanta_ga', 'Atlanta, GA', 'city', 'US', 'GA', 'Atlanta', 33.7490, -84.3880, 24000, '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('nashville_tn', 'Nashville, TN', 'city', 'US', 'TN', 'Nashville', 36.1627, -86.7816, 24000, '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('memphis_tn', 'Memphis, TN', 'city', 'US', 'TN', 'Memphis', 35.1495, -90.0490, 24000, '{"seed":"expand_leadgen_icp_options"}'::jsonb),
    ('denver_co', 'Denver, CO', 'city', 'US', 'CO', 'Denver', 39.7392, -104.9903, 24000, '{"seed":"expand_leadgen_icp_options"}'::jsonb)
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

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
select source.source_key,
    location.value,
    array[location.value],
    jsonb_build_object('seed', 'expand_leadgen_icp_options', 'country', location.country, 'region', location.region, 'locality', location.locality)
from (values ('overture'), ('osm'), ('alltheplaces'), ('foursquare_os_places')) as source(source_key)
cross join public.leadgen_icp_locations location
where location.enabled = true
and location.country = 'US'
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
select source.source_key,
    location.value,
    array[coalesce(location.region, location.country, location.value)],
    jsonb_build_object('seed', 'expand_leadgen_icp_options', 'country', location.country, 'region', location.region, 'locality', location.locality)
from (values ('website'), ('web.json_ld'), ('transport.fmcsa_safer'), ('regulated.nppes')) as source(source_key)
cross join public.leadgen_icp_locations location
where location.enabled = true
and location.country = 'US'
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select source.source_key,
    industry.value,
    array[industry.value],
    industry.label,
    jsonb_build_object('seed', 'expand_leadgen_icp_options', 'category', industry.category)
from (values ('website'), ('web.json_ld'), ('alltheplaces')) as source(source_key)
cross join public.leadgen_icp_industries industry
where industry.enabled = true
on conflict (source_key, icp_industry_value)
do update set native_values = excluded.native_values,
    native_label = excluded.native_label,
    enabled = true,
    metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata,
    updated_at = now();
