-- =========================================================
-- Sistema Cosecha App - esquema base
-- Multiempresa desde el inicio. Todas las tablas llevan empresa_id.
-- =========================================================

create extension if not exists pgcrypto;

-- ---------- Empresas y usuarios ----------
create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  codigo smallint not null unique check (codigo between 1 and 99), -- prefijo en códigos QR
  nombre text not null,
  rut text,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.perfiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  nombre text not null,
  email text,
  rol text not null default 'jefe' check (rol in ('admin','jefe','consulta')),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Funciones auxiliares para RLS (security definer evita recursión)
create or replace function public.mi_empresa() returns uuid
language sql stable security definer set search_path = public as $$
  select empresa_id from public.perfiles where user_id = auth.uid() and activo
$$;

create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from public.perfiles where user_id = auth.uid() and activo
$$;

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select rol = 'admin' from public.perfiles where user_id = auth.uid() and activo), false)
$$;

-- updated_at automático
create or replace function public.tg_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

-- ---------- Maestros ----------
create table public.huertos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nombre text not null,
  orden int not null default 0,
  activo boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (empresa_id, nombre)
);

create table public.especies (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nombre text not null,
  activo boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (empresa_id, nombre)
);

create table public.variedades (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  especie_id uuid not null references public.especies(id),
  nombre text not null,
  activo boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (empresa_id, especie_id, nombre)
);

create table public.cuarteles (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  huerto_id uuid not null references public.huertos(id),
  nombre text not null,
  variedad_id uuid references public.variedades(id),
  superficie_ha numeric(10,2),
  activo boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (empresa_id, huerto_id, nombre)
);

create table public.envases (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nombre text not null,
  alias text,
  kilos_referencia numeric(10,3) not null default 0, -- sin balanza: kilos estimados por envase
  activo boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (empresa_id, nombre)
);

create table public.calidades (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nombre text not null,
  alias text,
  orden int not null default 0,
  activo boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (empresa_id, nombre)
);

create table public.turnos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nombre text not null,
  orden int not null default 0,
  activo boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (empresa_id, nombre)
);

create table public.contratistas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  rut text,
  nombre text not null,
  activo boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (empresa_id, nombre)
);

create table public.trabajadores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  rut text not null,                -- formato 12345678-9, o código extranjero
  extranjero boolean not null default false,
  nombres text not null,
  apellido_paterno text,
  apellido_materno text,
  contratista_id uuid references public.contratistas(id),
  estado char(1) not null default 'A' check (estado in ('A','B','I')), -- Activo, Bloqueado, Inactivo
  updated_at timestamptz not null default now(),
  unique (empresa_id, rut)
);

create table public.cuadrillas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  huerto_id uuid references public.huertos(id),
  nombre text not null,
  jefe_user_id uuid references public.perfiles(user_id),
  activo boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (empresa_id, nombre)
);

create table public.tarifas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  especie_id uuid references public.especies(id),
  envase_id uuid not null references public.envases(id),
  calidad_id uuid references public.calidades(id),   -- null = cualquier calidad
  valor numeric(12,2) not null,                       -- $ por envase
  vigente_desde date not null default current_date,
  updated_at timestamptz not null default now()
);

-- Configuración de reglas por huerto (reemplaza TB_Configura)
create table public.config_huerto (
  huerto_id uuid primary key references public.huertos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  modo_captura text not null default 'credencial_cantidad'
    check (modo_captura in ('credencial_cantidad','credencial_caja')),
  horas_bloqueo_caja int not null default 12,     -- etiqueta de caja no reutilizable antes de N horas
  segundos_entre_lecturas int not null default 10, -- antirebote por trabajador
  max_cajas_por_lectura int not null default 10,
  exige_calidad boolean not null default true,
  exige_turno boolean not null default false,
  exige_contratista boolean not null default false,
  con_gps boolean not null default false,
  permite_rut_extranjero boolean not null default true,
  parametros jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- Tarjetas QR (módulo de credenciales y etiquetas) ----------
create table public.lotes_impresion (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  tipo char(1) not null check (tipo in ('W','B')),  -- W credencial, B caja
  descripcion text,
  cantidad int not null,
  desde bigint,
  hasta bigint,
  creado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.correlativos (
  empresa_id uuid not null references public.empresas(id),
  tipo char(1) not null,
  ultimo bigint not null default 0,
  primary key (empresa_id, tipo)
);

create table public.tarjetas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  codigo text not null unique,               -- ej: BC-W-0100000001
  tipo char(1) not null check (tipo in ('W','B')),
  correlativo bigint,
  lote_id uuid references public.lotes_impresion(id),
  origen text not null default 'generada' check (origen in ('generada','importada')),
  trabajador_id uuid references public.trabajadores(id),
  estado text not null default 'disponible' check (estado in ('disponible','asignada','anulada')),
  asignada_en timestamptz,
  updated_at timestamptz not null default now()
);
-- Un trabajador solo puede tener una credencial asignada a la vez
create unique index tarjetas_trabajador_unica on public.tarjetas(trabajador_id)
  where estado = 'asignada' and tipo = 'W';

-- ---------- Transaccionales ----------
create table public.entregas (
  id uuid primary key,                       -- UUID generado en el teléfono (idempotente)
  empresa_id uuid not null references public.empresas(id),
  huerto_id uuid not null references public.huertos(id),
  cuartel_id uuid not null references public.cuarteles(id),
  variedad_id uuid references public.variedades(id),
  envase_id uuid not null references public.envases(id),
  calidad_id uuid references public.calidades(id),
  turno_id uuid references public.turnos(id),
  contratista_id uuid references public.contratistas(id),
  cuadrilla_id uuid references public.cuadrillas(id),
  trabajador_id uuid not null references public.trabajadores(id),
  codigo_credencial text not null,
  codigo_caja text,
  cantidad numeric(10,2) not null default 1 check (cantidad > 0),
  kilos_estimados numeric(12,3) not null default 0,
  leido_en timestamptz not null,
  fecha date not null,
  lat numeric(10,7),
  lng numeric(10,7),
  dispositivo text,
  jefe_user_id uuid not null default auth.uid() references public.perfiles(user_id),
  estado char(1) not null default 'A' check (estado in ('A','X','D')), -- Activa, anulada, Duplicada
  observacion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index entregas_fecha_idx on public.entregas(empresa_id, fecha);
create index entregas_trab_idx on public.entregas(trabajador_id, fecha);
create index entregas_caja_idx on public.entregas(empresa_id, codigo_caja, leido_en) where codigo_caja is not null;

-- Detección de caja duplicada en el servidor (dos teléfonos offline leyendo la misma caja)
create or replace function public.tg_entrega_duplicada() returns trigger
language plpgsql security definer set search_path = public as $$
declare horas int;
begin
  if new.codigo_caja is not null and new.estado = 'A' then
    select coalesce(c.horas_bloqueo_caja, 12) into horas
      from public.config_huerto c where c.huerto_id = new.huerto_id;
    horas := coalesce(horas, 12);
    if exists (
      select 1 from public.entregas e
       where e.empresa_id = new.empresa_id
         and e.codigo_caja = new.codigo_caja
         and e.estado = 'A'
         and e.id <> new.id
         and e.leido_en > new.leido_en - make_interval(hours => horas)
         and e.leido_en <= new.leido_en
    ) then
      new.estado := 'D';
      new.observacion := coalesce(new.observacion || ' | ', '') || 'Caja ya registrada dentro de ' || horas || ' h';
    end if;
  end if;
  return new;
end $$;
create trigger entregas_duplicada before insert on public.entregas
  for each row execute function public.tg_entrega_duplicada();

-- Asignaciones de credencial hechas en terreno (bitácora)
create table public.asignaciones_credencial (
  id uuid primary key,
  empresa_id uuid not null references public.empresas(id),
  trabajador_id uuid references public.trabajadores(id),
  codigo text not null,
  accion text not null check (accion in ('asignar','liberar')),
  resultado text,
  hecho_en timestamptz not null default now(),
  hecho_por uuid default auth.uid()
);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['huertos','especies','variedades','cuarteles','envases','calidades','turnos',
    'contratistas','trabajadores','cuadrillas','tarifas','config_huerto','tarjetas','entregas']
  loop
    execute format('create trigger %I_updated before update on public.%I for each row execute function public.tg_updated_at()', t, t);
  end loop;
end $$;
