-- Leadgen contractor v1 ICP options and source mappings.
-- Run after 02_stage_capabilities.sql.

insert into public.leadgen_icp_industries (value, label, category, metadata)
values
    ('plumbers', 'Plumbers', 'home_services', '{"seed":"contractors_v1"}'::jsonb),
    ('electricians', 'Electricians', 'home_services', '{"seed":"contractors_v1"}'::jsonb),
    ('hvac_contractors', 'HVAC Contractors', 'home_services', '{"seed":"contractors_v1"}'::jsonb),
    ('roofers', 'Roofers', 'home_services', '{"seed":"contractors_v1"}'::jsonb),
    ('landscapers', 'Landscapers', 'home_services', '{"seed":"contractors_v1"}'::jsonb),
    ('cleaning_companies', 'Cleaning Companies', 'home_services', '{"seed":"contractors_v1"}'::jsonb),
    ('painters', 'Painters', 'home_services', '{"seed":"contractors_v1"}'::jsonb),
    ('remodellers', 'Remodellers', 'home_services', '{"seed":"contractors_v1"}'::jsonb),
    ('pest_control', 'Pest Control', 'home_services', '{"seed":"contractors_v1"}'::jsonb),
    ('lighting_contractors', 'Lighting Contractors', 'home_services', '{"seed":"contractors_v1"}'::jsonb),
    ('flooring_contractors', 'Flooring Contractors', 'home_services', '{"seed":"contractors_v1"}'::jsonb),
    ('general_contractors', 'General Contractors', 'home_services', '{"seed":"contractors_v1"}'::jsonb),
    ('waste_disposal', 'Waste Disposal', 'home_services', '{"seed":"contractors_v1"}'::jsonb),
    ('auto_repair_shops', 'Auto Repair Shops', 'local_services', '{"seed":"contractors_v1"}'::jsonb)
on conflict (value)
do update set
    label = excluded.label,
    category = excluded.category,
    enabled = true,
    metadata = public.leadgen_icp_industries.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_icp_locations (value, label, location_kind, country, region, locality, latitude, longitude, radius_meters, metadata)
values
    ('united_states', 'United States', 'country', 'US', null, null, 39.8283, -98.5795, 40000, '{"seed":"contractors_v1"}'::jsonb),
    ('texas', 'Texas', 'state', 'US', 'TX', null, 31.9686, -99.9018, 40000, '{"seed":"contractors_v1"}'::jsonb),
    ('florida', 'Florida', 'state', 'US', 'FL', null, 27.6648, -81.5158, 40000, '{"seed":"contractors_v1"}'::jsonb),
    ('north_carolina', 'North Carolina', 'state', 'US', 'NC', null, 35.7596, -79.0193, 40000, '{"seed":"contractors_v1"}'::jsonb),
    ('california', 'California', 'state', 'US', 'CA', null, 36.7783, -119.4179, 40000, '{"seed":"contractors_v1"}'::jsonb),
    ('dallas_tx', 'Dallas, TX', 'city', 'US', 'TX', 'Dallas', 32.7767, -96.7970, 24000, '{"seed":"contractors_v1"}'::jsonb),
    ('austin_tx', 'Austin, TX', 'city', 'US', 'TX', 'Austin', 30.2672, -97.7431, 24000, '{"seed":"contractors_v1"}'::jsonb),
    ('orlando_fl', 'Orlando, FL', 'city', 'US', 'FL', 'Orlando', 28.5383, -81.3792, 24000, '{"seed":"contractors_v1"}'::jsonb),
    ('los_angeles_ca', 'Los Angeles, CA', 'city', 'US', 'CA', 'Los Angeles', 34.0522, -118.2437, 24000, '{"seed":"contractors_v1"}'::jsonb)
on conflict (value)
do update set
    label = excluded.label,
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

with mappings(source_key, industry_value, native_values, native_label, metadata) as (
    values
        ('state_license.tx.tdlr', 'electricians', array['electrical_contractor','master_electrician','journeyman_electrician','electrical_sign_contractor'], 'Texas TDLR electrical licensing', '{"state":"TX","board":"tdlr"}'::jsonb),
        ('state_license.tx.tdlr', 'lighting_contractors', array['electrical_sign_contractor','electrical_contractor'], 'Texas TDLR electrical/sign licensing', '{"state":"TX","board":"tdlr"}'::jsonb),
        ('state_license.tx.tdlr', 'hvac_contractors', array['a_c_contractor','a_c_technician'], 'Texas TDLR A/C licensing', '{"state":"TX","board":"tdlr"}'::jsonb),
        ('state_license.tx.tdlr', 'water_well_services', array['water_well_driller','water_well_pump_installer'], 'Texas TDLR water well licensing', '{"state":"TX","board":"tdlr"}'::jsonb),
        ('state_license.tx.plumbing', 'plumbers', array['RMP'], 'Texas Responsible Master Plumber records', '{"state":"TX","board":"tsbpe"}'::jsonb),
        ('state_license.fl.dbpr', 'general_contractors', array['CGC','CBC','CRC'], 'Florida DBPR construction contractor records', '{"state":"FL","board":"dbpr_construction"}'::jsonb),
        ('state_license.fl.dbpr', 'home_builders', array['CGC','CBC','CRC'], 'Florida DBPR building/residential contractor records', '{"state":"FL","board":"dbpr_construction"}'::jsonb),
        ('state_license.fl.dbpr', 'remodellers', array['CGC','CBC','CRC'], 'Florida DBPR building/residential contractor records', '{"state":"FL","board":"dbpr_construction"}'::jsonb),
        ('state_license.fl.dbpr', 'roofers', array['CCC'], 'Florida DBPR roofing contractor records', '{"state":"FL","board":"dbpr_construction"}'::jsonb),
        ('state_license.fl.dbpr', 'hvac_contractors', array['CAC','CMC'], 'Florida DBPR air-conditioning/mechanical contractor records', '{"state":"FL","board":"dbpr_construction"}'::jsonb),
        ('state_license.fl.dbpr', 'plumbers', array['CFC'], 'Florida DBPR plumbing contractor records', '{"state":"FL","board":"dbpr_construction"}'::jsonb),
        ('state_license.fl.dbpr', 'pool_builders', array['CPC'], 'Florida DBPR pool contractor records', '{"state":"FL","board":"dbpr_construction"}'::jsonb),
        ('state_license.fl.dbpr', 'solar_installers', array['SCC'], 'Florida DBPR solar contractor records', '{"state":"FL","board":"dbpr_construction"}'::jsonb),
        ('state_license.fl.dbpr', 'flooring_contractors', array['construction_license'], 'Florida DBPR construction records', '{"state":"FL","board":"dbpr_construction","filter":"business_name_match"}'::jsonb),
        ('state_license.fl.dbpr', 'lighting_contractors', array['construction_license'], 'Florida DBPR construction records', '{"state":"FL","board":"dbpr_construction","filter":"business_name_match"}'::jsonb),
        ('state_license.fl.electrical', 'electricians', array['electrical_contractor'], 'Florida DBPR electrical contractor records', '{"state":"FL","board":"dbpr_electrical"}'::jsonb),
        ('state_license.fl.electrical', 'lighting_contractors', array['electrical_contractor'], 'Florida DBPR electrical contractor records', '{"state":"FL","board":"dbpr_electrical"}'::jsonb),
        ('state_license.fl.electrical', 'solar_installers', array['electrical_contractor'], 'Florida DBPR electrical contractor records', '{"state":"FL","board":"dbpr_electrical"}'::jsonb),
        ('state_license.fl.electrical', 'pool_builders', array['electrical_contractor'], 'Florida DBPR electrical contractor records', '{"state":"FL","board":"dbpr_electrical"}'::jsonb),
        ('state_license.fl.electrical', 'hvac_contractors', array['electrical_contractor'], 'Florida DBPR electrical contractor records', '{"state":"FL","board":"dbpr_electrical"}'::jsonb),
        ('state_license.nc.general_contractors', 'general_contractors', array['27','28','26'], 'NC general contractor classifications', '{"state":"NC","board":"nclbgc"}'::jsonb),
        ('state_license.nc.general_contractors', 'home_builders', array['27','28'], 'NC residential/building classifications', '{"state":"NC","board":"nclbgc"}'::jsonb),
        ('state_license.nc.general_contractors', 'remodellers', array['27','28','44'], 'NC remodel classifications', '{"state":"NC","board":"nclbgc"}'::jsonb),
        ('state_license.nc.general_contractors', 'roofers', array['49'], 'NC roofing classification', '{"state":"NC","board":"nclbgc"}'::jsonb),
        ('state_license.nc.general_contractors', 'flooring_contractors', array['44'], 'NC interior construction classification', '{"state":"NC","board":"nclbgc"}'::jsonb),
        ('state_license.nc.general_contractors', 'concrete_contractors', array['42'], 'NC concrete classification', '{"state":"NC","board":"nclbgc"}'::jsonb),
        ('state_license.nc.general_contractors', 'pool_builders', array['51'], 'NC swimming pool classification', '{"state":"NC","board":"nclbgc"}'::jsonb),
        ('regulated.epa_echo', 'waste_disposal', array['cwa_facility'], 'EPA ECHO facility search', '{"source":"epa_echo","mapping_mode":"regulated_facility"}'::jsonb),
        ('regulated.epa_echo', 'cleaning_companies', array['cwa_facility'], 'EPA ECHO facility search', '{"source":"epa_echo","mapping_mode":"regulated_facility"}'::jsonb),
        ('regulated.epa_echo', 'restoration_companies', array['cwa_facility'], 'EPA ECHO facility search', '{"source":"epa_echo","mapping_mode":"regulated_facility"}'::jsonb),
        ('regulated.epa_echo', 'water_well_services', array['cwa_facility'], 'EPA ECHO facility search', '{"source":"epa_echo","mapping_mode":"regulated_facility"}'::jsonb),
        ('transport.fmcsa_safer', 'waste_disposal', array['carrier','hauling','waste'], 'FMCSA SAFER carrier snapshot', '{"source":"fmcsa","mapping_mode":"carrier_support"}'::jsonb)
)
insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select source_key, industry_value, native_values, native_label, metadata || '{"seed":"contractors_v1"}'::jsonb
from mappings
on conflict (source_key, icp_industry_value)
do update set
    native_values = excluded.native_values,
    native_label = excluded.native_label,
    enabled = true,
    metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata,
    updated_at = now();

with contractor_industries(value) as (
    values
        ('plumbers'),
        ('electricians'),
        ('hvac_contractors'),
        ('roofers'),
        ('landscapers'),
        ('cleaning_companies'),
        ('painters'),
        ('remodellers'),
        ('pest_control'),
        ('lighting_contractors'),
        ('flooring_contractors'),
        ('general_contractors'),
        ('waste_disposal'),
        ('auto_repair_shops')
),
public_sources(source_key, native_label) as (
    values
        ('permits.tx.dallas', 'Dallas contractor public records'),
        ('permits.tx.austin', 'Austin contractor public records'),
        ('permits.fl.orlando', 'Orlando permit public records'),
        ('registry.fl.orlando_btr', 'Orlando business tax receipt records'),
        ('permits.ca.los_angeles', 'Los Angeles permit public records'),
        ('website', 'Candidate website crawl'),
        ('phone.basic_format_validation', 'Internal owner-phone format validation')
)
insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select public_sources.source_key,
    contractor_industries.value,
    array[contractor_industries.value],
    public_sources.native_label,
    jsonb_build_object('seed', 'contractors_v1', 'mapping_mode', 'candidate_name_search')
from public_sources
cross join contractor_industries
join public.leadgen_icp_industries industry on industry.value = contractor_industries.value
on conflict (source_key, icp_industry_value)
do update set
    native_values = excluded.native_values,
    native_label = excluded.native_label,
    enabled = true,
    metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata,
    updated_at = now();

with seed_mappings(source_key, industry_value, native_values, native_label) as (
    values
        ('overture', 'cleaning_companies', array['cleaning_service','janitorial_service','commercial_cleaning_service'], 'Overture cleaning services'),
        ('overture', 'pest_control', array['pest_control_service'], 'Overture pest control'),
        ('overture', 'lighting_contractors', array['electrician','lighting_contractor'], 'Overture lighting/electrical contractors'),
        ('overture', 'waste_disposal', array['waste_management_service','garbage_collection_service','junk_removal_service'], 'Overture waste services'),
        ('overture', 'auto_repair_shops', array['auto_repair_shop','auto_body_shop'], 'Overture auto repair'),
        ('osm', 'cleaning_companies', array['office=cleaning','craft=cleaner'], 'OSM cleaning tags'),
        ('osm', 'pest_control', array['craft=pest_control'], 'OSM pest control tags'),
        ('osm', 'lighting_contractors', array['craft=electrician','shop=lighting'], 'OSM lighting/electrical tags'),
        ('osm', 'waste_disposal', array['amenity=recycling','shop=waste_disposal'], 'OSM waste tags'),
        ('osm', 'auto_repair_shops', array['shop=car_repair','shop=car'], 'OSM auto repair tags')
)
insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select source_key, industry_value, native_values, native_label, '{"seed":"contractors_v1","mapping_mode":"seed_category"}'::jsonb
from seed_mappings
on conflict (source_key, icp_industry_value)
do update set
    native_values = excluded.native_values,
    native_label = excluded.native_label,
    enabled = true,
    metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata,
    updated_at = now();

with source_regions(source_key, region) as (
    values
        ('state_license.tx.tdlr', 'TX'),
        ('state_license.tx.plumbing', 'TX'),
        ('permits.tx.dallas', 'TX'),
        ('permits.tx.austin', 'TX'),
        ('state_license.fl.dbpr', 'FL'),
        ('state_license.fl.electrical', 'FL'),
        ('permits.fl.orlando', 'FL'),
        ('registry.fl.orlando_btr', 'FL'),
        ('state_license.nc.general_contractors', 'NC'),
        ('permits.ca.los_angeles', 'CA')
)
insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
select source_regions.source_key,
    location.value,
    array[coalesce(location.locality, location.region, location.value)],
    jsonb_build_object('seed', 'contractors_v1', 'region', location.region, 'locality', location.locality)
from source_regions
join public.leadgen_icp_locations location on location.enabled = true and location.country = 'US' and location.region = source_regions.region
on conflict (source_key, icp_location_value)
do update set
    native_values = excluded.native_values,
    enabled = true,
    metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
select source.source_key,
    location.value,
    array[coalesce(location.region, location.country, location.value)],
    jsonb_build_object('seed', 'contractors_v1', 'country', location.country, 'region', location.region)
from (values ('regulated.epa_echo'), ('transport.fmcsa_safer'), ('website'), ('phone.basic_format_validation')) as source(source_key)
cross join public.leadgen_icp_locations location
where location.enabled = true
and location.country = 'US'
on conflict (source_key, icp_location_value)
do update set
    native_values = excluded.native_values,
    enabled = true,
    metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata,
    updated_at = now();
