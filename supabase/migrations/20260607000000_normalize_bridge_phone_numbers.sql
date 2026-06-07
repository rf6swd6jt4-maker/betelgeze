create or replace function public.normalize_bridge_phone_address(address text)
returns text
language plpgsql
immutable
as $$
declare
    channel text := 'whatsapp';
    phone text;
    country_code text;
    trunk_zero_country_codes text[] := array[
        '27',
        '31',
        '32',
        '33',
        '353',
        '44',
        '49',
        '61',
        '64'
    ];
begin
    if address is null or btrim(address) = '' then
        return address;
    end if;

    if position(':' in address) > 0 then
        channel := lower(split_part(address, ':', 1));
        phone := split_part(address, ':', 2);
    else
        phone := address;
    end if;

    phone := regexp_replace(phone, '\m(ext|extension|x)\.?\s*[0-9]+\M$', '', 'i');
    phone := regexp_replace(phone, '[^0-9+]', '', 'g');
    phone := regexp_replace(phone, '(.)\+', '\1', 'g');

    if phone like '00%' then
        phone := '+' || substring(phone from 3);
    end if;

    if phone = '' then
        return address;
    end if;

    if phone not like '+%' then
        if phone ~ '^08[0-9]{7,9}$' then
            phone := '+353' || substring(phone from 2);
        else
            phone := '+' || phone;
        end if;
    end if;

    foreach country_code in array trunk_zero_country_codes loop
        if phone like '+' || country_code || '0%' then
            phone := '+' || country_code || substring(phone from length(country_code) + 3);
            exit;
        end if;
    end loop;

    return channel || ':' || phone;
end;
$$;

update public.clients
set phone = public.normalize_bridge_phone_address(phone)
where phone is not null;

update public.client_communication_channels
set
    external_address = public.normalize_bridge_phone_address(external_address),
    updated_at = now()
where provider = 'meta_whatsapp';

update public.client_messages
set from_address = public.normalize_bridge_phone_address(from_address)
where provider = 'meta_whatsapp'
  and from_address is not null;

update public.client_messages
set to_address = public.normalize_bridge_phone_address(to_address)
where provider = 'meta_whatsapp'
  and to_address is not null;
