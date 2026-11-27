-- Carro (acoplado / rampla) del camión en el despacho, y carro habitual en el maestro de camiones.
alter table public.camiones add column carro text;
alter table public.despachos add column carro text;

create or replace function public.tg_camion_patente() returns trigger
language plpgsql as $$
begin
  new.patente := public.normalizar_patente(new.patente);
  new.carro := public.normalizar_patente(new.carro);
  return new;
end $$;
drop trigger if exists camiones_patente on public.camiones;
create trigger camiones_patente before insert or update of patente, carro on public.camiones
  for each row execute function public.tg_camion_patente();

create or replace function public.tg_despacho_camion() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pat text := public.normalizar_patente(new.patente); v_id uuid;
begin
  new.carro := public.normalizar_patente(new.carro);
  if v_pat is null or v_pat !~ '^[A-Z0-9]{4,8}$' then return new; end if;
  new.patente := v_pat;
  insert into public.camiones (empresa_id, patente, transportista, chofer, carro)
  values (new.empresa_id, v_pat, nullif(trim(new.transportista), ''), nullif(trim(new.chofer), ''), new.carro)
  on conflict (empresa_id, patente) do update
    set transportista = coalesce(camiones.transportista, excluded.transportista),
        chofer = coalesce(camiones.chofer, excluded.chofer),
        carro = coalesce(camiones.carro, excluded.carro)
  returning id into v_id;
  new.camion_id := v_id;
  return new;
end $$;
drop trigger if exists despachos_camion on public.despachos;
create trigger despachos_camion before insert or update of patente, transportista, chofer, carro on public.despachos
  for each row execute function public.tg_despacho_camion();
