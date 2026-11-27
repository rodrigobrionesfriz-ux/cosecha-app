-- Destinos de despacho: packings (misma ficha que una empresa) con una o más plantas (direcciones).
-- Los ids pueden venir del teléfono (packing o planta agregados sin señal al despachar).
create table public.packings (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.mi_empresa() references public.empresas(id) on delete cascade,
  nombre text not null,            -- razón social
  nombre_corto text,
  rut text,
  giro text,
  direccion text,                  -- casa matriz
  comuna text,
  ciudad text,
  telefono text,
  email text,
  representante text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index packings_rut_uq on public.packings (empresa_id, rut) where rut is not null;
create trigger packings_updated before update on public.packings for each row execute function public.tg_updated_at();

create table public.packing_plantas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.mi_empresa() references public.empresas(id) on delete cascade,
  packing_id uuid not null references public.packings(id) on delete cascade,
  nombre text not null,            -- ej: Planta San Clemente
  direccion text,
  comuna text,
  ciudad text,
  telefono text,
  contacto text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index packing_plantas_packing on public.packing_plantas (packing_id);
create trigger packing_plantas_updated before update on public.packing_plantas for each row execute function public.tg_updated_at();

-- RUT sin puntos ni guion
create or replace function public.tg_packing_rut() returns trigger
language plpgsql as $$ begin new.rut := nullif(upper(regexp_replace(coalesce(new.rut, ''), '[^0-9kK]', '', 'g')), ''); return new; end $$;
create trigger packings_rut before insert or update of rut on public.packings for each row execute function public.tg_packing_rut();

do $$
declare t text;
begin
  foreach t in array array['packings', 'packing_plantas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I_sel on public.%I for select to authenticated using (empresa_id = public.mi_empresa())', t, t);
    execute format('create policy %I_ins on public.%I for insert to authenticated with check (empresa_id = public.mi_empresa() and public.mi_rol() in (''admin'', ''acopio''))', t, t);
    execute format('create policy %I_upd on public.%I for update to authenticated using (empresa_id = public.mi_empresa() and public.es_admin()) with check (empresa_id = public.mi_empresa() and public.es_admin())', t, t);
    execute format('create policy %I_del on public.%I for delete to authenticated using (empresa_id = public.mi_empresa() and public.es_admin())', t, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

alter table public.despachos
  add column packing_id uuid references public.packings(id),
  add column planta_id uuid references public.packing_plantas(id);
