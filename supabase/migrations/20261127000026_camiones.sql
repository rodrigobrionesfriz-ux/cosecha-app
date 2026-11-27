-- Camiones para despacho: maestro por empresa (patente única) que la app de acopio
-- descarga para elegir. Un camión nuevo ingresado en el teléfono (con o sin señal)
-- se registra solo al subir el despacho (trigger en despachos).
create table public.camiones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.mi_empresa() references public.empresas(id) on delete cascade,
  patente text not null check (patente ~ '^[A-Z0-9]{4,8}$'),
  transportista text,
  chofer text,
  telefono text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, patente)
);
create trigger camiones_updated before update on public.camiones for each row execute function public.tg_updated_at();

alter table public.camiones enable row level security;
create policy camiones_sel on public.camiones for select to authenticated using (empresa_id = public.mi_empresa());
create policy camiones_ins on public.camiones for insert to authenticated
  with check (empresa_id = public.mi_empresa() and public.mi_rol() in ('admin', 'acopio'));
create policy camiones_upd on public.camiones for update to authenticated
  using (empresa_id = public.mi_empresa() and public.es_admin()) with check (empresa_id = public.mi_empresa() and public.es_admin());
create policy camiones_del on public.camiones for delete to authenticated
  using (empresa_id = public.mi_empresa() and public.es_admin());
revoke all on public.camiones from anon;

/** Patente normalizada: mayúsculas, sin espacios, guiones ni puntos */
create or replace function public.normalizar_patente(p text) returns text
language sql immutable as $$ select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '') $$;

alter table public.despachos
  add column camion_id uuid references public.camiones(id),
  add column transportista text;

-- Al guardar un despacho: normaliza la patente, crea el camión si no existe y lo enlaza
create or replace function public.tg_despacho_camion() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pat text := public.normalizar_patente(new.patente); v_id uuid;
begin
  if v_pat is null or v_pat !~ '^[A-Z0-9]{4,8}$' then return new; end if;
  new.patente := v_pat;
  insert into public.camiones (empresa_id, patente, transportista, chofer)
  values (new.empresa_id, v_pat, nullif(trim(new.transportista), ''), nullif(trim(new.chofer), ''))
  on conflict (empresa_id, patente) do update
    set transportista = coalesce(camiones.transportista, excluded.transportista),
        chofer = coalesce(camiones.chofer, excluded.chofer)
  returning id into v_id;
  new.camion_id := v_id;
  return new;
end $$;
create trigger despachos_camion before insert or update of patente, transportista, chofer on public.despachos
  for each row execute function public.tg_despacho_camion();
revoke execute on function public.tg_despacho_camion() from public, anon, authenticated;

-- Camiones de los despachos ya hechos
insert into public.camiones (empresa_id, patente, chofer)
select distinct on (d.empresa_id, public.normalizar_patente(d.patente)) d.empresa_id, public.normalizar_patente(d.patente), nullif(trim(d.chofer), '')
  from public.despachos d
 where public.normalizar_patente(d.patente) ~ '^[A-Z0-9]{4,8}$'
 order by d.empresa_id, public.normalizar_patente(d.patente), d.abierto_en desc
on conflict (empresa_id, patente) do nothing;
update public.despachos d set camion_id = c.id
  from public.camiones c
 where c.empresa_id = d.empresa_id and c.patente = public.normalizar_patente(d.patente) and d.camion_id is null;

-- Patente normalizada también al crear o editar desde el panel
create or replace function public.tg_camion_patente() returns trigger
language plpgsql as $$ begin new.patente := public.normalizar_patente(new.patente); return new; end $$;
create trigger camiones_patente before insert or update of patente on public.camiones
  for each row execute function public.tg_camion_patente();
