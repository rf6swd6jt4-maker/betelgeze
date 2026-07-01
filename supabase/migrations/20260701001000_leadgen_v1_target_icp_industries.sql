insert into public.leadgen_icp_industries (value, label, category, metadata)
values
    ('cleaning_companies', 'Cleaning Companies', 'home_services', '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb),
    ('pest_control', 'Pest Control', 'home_services', '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb),
    ('lighting_contractors', 'Lighting Contractors', 'home_services', '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb),
    ('auto_repair', 'Auto Repair', 'local_services', '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb),
    ('waste_disposal', 'Waste Disposal', 'site_services', '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb)
on conflict (value)
do update set label = excluded.label,
    category = excluded.category,
    enabled = true,
    metadata = public.leadgen_icp_industries.metadata || excluded.metadata,
    updated_at = now();

update public.leadgen_icp_industries
set metadata = metadata || '{"target_v1":true,"target_v1_states":["TX","FL","CA","AZ"]}'::jsonb,
    updated_at = now()
where value in (
    'plumbers',
    'electricians',
    'hvac_contractors',
    'roofers',
    'landscapers',
    'cleaning_companies',
    'painters',
    'remodellers',
    'pest_control',
    'lighting_contractors',
    'flooring_contractors',
    'general_contractors',
    'waste_disposal',
    'auto_repair'
);

insert into public.leadgen_icp_locations (value, label, location_kind, country, region, locality, latitude, longitude, radius_meters, metadata)
values
    ('texas', 'Texas', 'state', 'US', 'TX', null, 31.9686, -99.9018, 40000, '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb),
    ('florida', 'Florida', 'state', 'US', 'FL', null, 27.6648, -81.5158, 40000, '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb),
    ('california', 'California', 'state', 'US', 'CA', null, 36.7783, -119.4179, 40000, '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb),
    ('arizona', 'Arizona', 'state', 'US', 'AZ', null, 34.0489, -111.0937, 40000, '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb),
    ('dallas_tx', 'Dallas, TX', 'city', 'US', 'TX', 'Dallas', 32.7767, -96.7970, 24000, '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb),
    ('austin_tx', 'Austin, TX', 'city', 'US', 'TX', 'Austin', 30.2672, -97.7431, 24000, '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb),
    ('houston_tx', 'Houston, TX', 'city', 'US', 'TX', 'Houston', 29.7604, -95.3698, 24000, '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb),
    ('san_antonio_tx', 'San Antonio, TX', 'city', 'US', 'TX', 'San Antonio', 29.4241, -98.4936, 24000, '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb),
    ('miami_fl', 'Miami, FL', 'city', 'US', 'FL', 'Miami', 25.7617, -80.1918, 24000, '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb),
    ('orlando_fl', 'Orlando, FL', 'city', 'US', 'FL', 'Orlando', 28.5383, -81.3792, 24000, '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb),
    ('tampa_fl', 'Tampa, FL', 'city', 'US', 'FL', 'Tampa', 27.9506, -82.4572, 24000, '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb),
    ('jacksonville_fl', 'Jacksonville, FL', 'city', 'US', 'FL', 'Jacksonville', 30.3322, -81.6557, 24000, '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb),
    ('los_angeles_ca', 'Los Angeles, CA', 'city', 'US', 'CA', 'Los Angeles', 34.0522, -118.2437, 24000, '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb),
    ('san_diego_ca', 'San Diego, CA', 'city', 'US', 'CA', 'San Diego', 32.7157, -117.1611, 24000, '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb),
    ('bay_area_ca', 'Bay Area, CA', 'metro', 'US', 'CA', 'San Francisco Bay Area', 37.7749, -122.4194, 40000, '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb),
    ('phoenix_az', 'Phoenix, AZ', 'city', 'US', 'AZ', 'Phoenix', 33.4484, -112.0740, 24000, '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb),
    ('tucson_az', 'Tucson, AZ', 'city', 'US', 'AZ', 'Tucson', 32.2226, -110.9747, 24000, '{"seed":"leadgen_v1_owner_identity_sources","target_v1":true}'::jsonb)
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
