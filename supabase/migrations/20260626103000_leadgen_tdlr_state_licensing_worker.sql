update public.leadgen_source_options
set metadata = metadata || jsonb_build_object(
    'board', 'tdlr',
    'board_label', 'Texas Department of Licensing and Regulation',
    'tdlr_county', label
),
updated_at = now()
where source_key = 'state_licensing'
and option_kind = 'location';

update public.leadgen_source_options
set metadata = metadata || jsonb_build_object('board', 'tdlr', 'board_label', 'Texas Department of Licensing and Regulation', 'tdlr_status', 'AIRREF'),
enabled = true,
updated_at = now()
where source_key = 'state_licensing'
and option_kind = 'industry'
and value = 'a_c_contractor';

update public.leadgen_source_options
set metadata = metadata || jsonb_build_object('board', 'tdlr', 'board_label', 'Texas Department of Licensing and Regulation', 'tdlr_status', 'ACTECH'),
enabled = true,
updated_at = now()
where source_key = 'state_licensing'
and option_kind = 'industry'
and value = 'a_c_technician';

update public.leadgen_source_options
set metadata = metadata || jsonb_build_object('board', 'tdlr', 'board_label', 'Texas Department of Licensing and Regulation', 'tdlr_status', 'ELCTRC', 'tdlr_endorsement', 'RAIC'),
enabled = true,
updated_at = now()
where source_key = 'state_licensing'
and option_kind = 'industry'
and value = 'appliance_installation_contractor';

update public.leadgen_source_options
set metadata = metadata || jsonb_build_object('board', 'tdlr', 'board_label', 'Texas Department of Licensing and Regulation', 'tdlr_status', 'ELCTRC', 'tdlr_endorsement', 'RAI'),
enabled = true,
updated_at = now()
where source_key = 'state_licensing'
and option_kind = 'industry'
and value = 'appliance_installer';

update public.leadgen_source_options
set metadata = metadata || jsonb_build_object('board', 'tdlr', 'board_label', 'Texas Department of Licensing and Regulation', 'tdlr_status', 'BLRAGY'),
enabled = true,
updated_at = now()
where source_key = 'state_licensing'
and option_kind = 'industry'
and value = 'boiler_authorized_inspection_agency';

update public.leadgen_source_options
set metadata = metadata || jsonb_build_object('board', 'tdlr', 'board_label', 'Texas Department of Licensing and Regulation', 'tdlr_status', 'BLRINS'),
enabled = true,
updated_at = now()
where source_key = 'state_licensing'
and option_kind = 'industry'
and value = 'boiler_inspectors';

update public.leadgen_source_options
set metadata = metadata || jsonb_build_object('board', 'tdlr', 'board_label', 'Texas Department of Licensing and Regulation', 'tdlr_status', 'ELCTRC', 'tdlr_endorsement', 'AE'),
enabled = true,
updated_at = now()
where source_key = 'state_licensing'
and option_kind = 'industry'
and value in ('apprentice_electrician', 'electrical_apprentice');

update public.leadgen_source_options
set metadata = metadata || jsonb_build_object('board', 'tdlr', 'board_label', 'Texas Department of Licensing and Regulation', 'tdlr_status', 'ELCTRC', 'tdlr_endorsement', 'SA'),
enabled = true,
updated_at = now()
where source_key = 'state_licensing'
and option_kind = 'industry'
and value = 'apprentice_sign_electrician';

update public.leadgen_source_options
set metadata = metadata || jsonb_build_object('board', 'tdlr', 'board_label', 'Texas Department of Licensing and Regulation', 'tdlr_status', 'ELCTRC', 'tdlr_endorsement', 'EC'),
enabled = true,
updated_at = now()
where source_key = 'state_licensing'
and option_kind = 'industry'
and value = 'electrical_contractor';

update public.leadgen_source_options
set metadata = metadata || jsonb_build_object('board', 'tdlr', 'board_label', 'Texas Department of Licensing and Regulation', 'tdlr_status', 'ELCTRC', 'tdlr_endorsement', 'SC'),
enabled = true,
updated_at = now()
where source_key = 'state_licensing'
and option_kind = 'industry'
and value = 'electrical_sign_contractor';

update public.leadgen_source_options
set metadata = metadata || jsonb_build_object('board', 'tdlr', 'board_label', 'Texas Department of Licensing and Regulation', 'tdlr_status', 'ELCTRC', 'tdlr_endorsement', 'JE'),
enabled = true,
updated_at = now()
where source_key = 'state_licensing'
and option_kind = 'industry'
and value = 'journeyman_electrician';

update public.leadgen_source_options
set metadata = metadata || jsonb_build_object('board', 'tdlr', 'board_label', 'Texas Department of Licensing and Regulation', 'tdlr_status', 'ELCTRC', 'tdlr_endorsement', 'ME'),
enabled = true,
updated_at = now()
where source_key = 'state_licensing'
and option_kind = 'industry'
and value = 'master_electrician';

update public.leadgen_source_options
set metadata = metadata || jsonb_build_object('board', 'tdlr', 'board_label', 'Texas Department of Licensing and Regulation', 'tdlr_status', 'WWDPMP', 'tdlr_endorsement', 'W'),
enabled = true,
updated_at = now()
where source_key = 'state_licensing'
and option_kind = 'industry'
and value = 'water_well_driller';

update public.leadgen_source_options
set metadata = metadata || jsonb_build_object('board', 'tdlr', 'board_label', 'Texas Department of Licensing and Regulation', 'tdlr_status', 'WWDPMP', 'tdlr_endorsement', 'I'),
enabled = true,
updated_at = now()
where source_key = 'state_licensing'
and option_kind = 'industry'
and value = 'water_well_pump_installer';
