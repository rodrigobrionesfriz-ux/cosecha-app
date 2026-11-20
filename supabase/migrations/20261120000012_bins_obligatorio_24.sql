-- El bin es un paso obligatorio del día: por defecto se usa y se cierra a los 24 envases (totes).
alter table public.config_huerto alter column usa_bins set default true;
alter table public.config_huerto alter column max_envases_bin set default 24;
update public.config_huerto set usa_bins = true, max_envases_bin = case when max_envases_bin = 0 then 24 else max_envases_bin end;
