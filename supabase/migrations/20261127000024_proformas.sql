-- Proformas de cosecha emitidas, con número correlativo por empresa (correlativos tipo 'P').
-- "datos" guarda la proforma completa tal como se emitió, para reimprimirla idéntica.
create table public.proformas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero bigint not null,
  contratista_id uuid references public.contratistas(id),
  contratista text not null,
  mes text not null check (mes ~ '^\d{4}-\d{2}$'),
  variedades text,
  neto numeric(14,0) not null,
  iva numeric(14,0) not null,
  total numeric(14,0) not null,
  datos jsonb not null,
  estado text not null default 'emitida' check (estado in ('emitida','anulada')),
  motivo_anulacion text,
  anulada_en timestamptz,
  anulada_por uuid,
  creado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index proformas_emp_mes on public.proformas (empresa_id, mes);

alter table public.proformas enable row level security;
create policy proformas_sel on public.proformas for select to authenticated using (empresa_id = public.mi_empresa());
-- Se crean solo con registrar_proforma(); se anulan con anular_proforma(). Sin borrado.
revoke all on public.proformas from anon;
revoke insert, update, delete on public.proformas from authenticated;

create or replace function public.registrar_proforma(p_datos jsonb)
returns table (id uuid, numero bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.mi_empresa();
  v_num bigint; v_id uuid;
begin
  if not public.es_admin() then raise exception 'Solo administradores pueden emitir proformas'; end if;
  if coalesce(p_datos->>'mes', '') !~ '^\d{4}-\d{2}$' then raise exception 'Mes inválido'; end if;

  insert into public.correlativos(empresa_id, tipo, ultimo) values (v_emp, 'P', 0)
    on conflict (empresa_id, tipo) do nothing;
  update public.correlativos c set ultimo = c.ultimo + 1
    where c.empresa_id = v_emp and c.tipo = 'P'
    returning c.ultimo into v_num;

  insert into public.proformas(empresa_id, numero, contratista_id, contratista, mes, variedades, neto, iva, total, datos)
  values (v_emp, v_num, nullif(p_datos->>'contratistaId', '')::uuid, coalesce(p_datos->>'contratista', 'Contratista'),
          p_datos->>'mes', p_datos->>'variedades',
          round(coalesce((p_datos->>'neto')::numeric, 0)), round(coalesce((p_datos->>'iva')::numeric, 0)), round(coalesce((p_datos->>'total')::numeric, 0)),
          p_datos || jsonb_build_object('numero', v_num, 'emitida', to_char(now() at time zone 'America/Santiago', 'YYYY-MM-DD')))
  returning proformas.id into v_id;
  return query select v_id, v_num;
end $$;

create or replace function public.anular_proforma(p_id uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'Solo administradores pueden anular proformas'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indica el motivo de la anulación'; end if;
  update public.proformas set estado = 'anulada', motivo_anulacion = trim(p_motivo), anulada_en = now(), anulada_por = auth.uid()
   where id = p_id and empresa_id = public.mi_empresa() and estado = 'emitida';
  if not found then raise exception 'La proforma no existe o ya está anulada'; end if;
end $$;

revoke execute on function public.registrar_proforma(jsonb) from public, anon;
revoke execute on function public.anular_proforma(uuid, text) from public, anon;
grant execute on function public.registrar_proforma(jsonb) to authenticated;
grant execute on function public.anular_proforma(uuid, text) to authenticated;
