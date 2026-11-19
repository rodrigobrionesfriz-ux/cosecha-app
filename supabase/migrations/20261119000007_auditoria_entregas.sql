-- Auditoría de entregas: editar / anular / restaurar solo vía funciones, siempre con motivo.
-- Las entregas anuladas se conservan (estado 'X') y quedan fuera de los reportes.
create table public.auditoria_entregas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  entrega_id uuid not null references public.entregas(id),
  accion text not null check (accion in ('editar','anular','restaurar','validar')),
  motivo text not null check (length(trim(motivo)) >= 3),
  antes jsonb,
  despues jsonb,
  usuario_id uuid not null default auth.uid(),
  usuario_nombre text,
  creado_en timestamptz not null default now()
);
create index auditoria_entrega_idx on public.auditoria_entregas(entrega_id, creado_en);
create index auditoria_empresa_idx on public.auditoria_entregas(empresa_id, creado_en);
alter table public.auditoria_entregas enable row level security;
create policy auditoria_sel on public.auditoria_entregas for select to authenticated
  using (empresa_id = public.mi_empresa() and public.mi_rol() in ('admin','consulta'));

alter table public.entregas
  add column editada boolean not null default false,
  add column anulada_en timestamptz,
  add column anulada_por uuid references public.perfiles(user_id),
  add column motivo_anulacion text;

drop policy if exists entregas_upd on public.entregas;

create or replace function public.editar_entrega(p_id uuid, p_cambios jsonb, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.mi_empresa();
  v_antes public.entregas%rowtype;
  v_despues public.entregas%rowtype;
  v_cuartel public.cuarteles%rowtype;
  v_kilos numeric;
begin
  if not public.es_admin() then raise exception 'Solo administradores pueden editar registros'; end if;
  if length(trim(coalesce(p_motivo,''))) < 3 then raise exception 'Debes indicar el motivo de la edición'; end if;
  select * into v_antes from public.entregas where id = p_id and empresa_id = v_emp for update;
  if not found then raise exception 'Registro no encontrado'; end if;
  if v_antes.estado = 'X' then raise exception 'El registro está anulado; restáuralo antes de editarlo'; end if;
  if p_cambios ? 'cuartel_id' then
    select * into v_cuartel from public.cuarteles where id = (p_cambios->>'cuartel_id')::uuid and empresa_id = v_emp;
    if not found then raise exception 'Cuartel inválido'; end if;
  else
    select * into v_cuartel from public.cuarteles where id = v_antes.cuartel_id;
  end if;
  update public.entregas set
    cuartel_id     = v_cuartel.id,
    huerto_id      = v_cuartel.huerto_id,
    variedad_id    = coalesce(v_cuartel.variedad_id, variedad_id),
    trabajador_id  = coalesce((p_cambios->>'trabajador_id')::uuid, trabajador_id),
    envase_id      = coalesce((p_cambios->>'envase_id')::uuid, envase_id),
    calidad_id     = case when p_cambios ? 'calidad_id' then nullif(p_cambios->>'calidad_id','')::uuid else calidad_id end,
    turno_id       = case when p_cambios ? 'turno_id' then nullif(p_cambios->>'turno_id','')::uuid else turno_id end,
    contratista_id = case when p_cambios ? 'contratista_id' then nullif(p_cambios->>'contratista_id','')::uuid else contratista_id end,
    cantidad       = coalesce((p_cambios->>'cantidad')::numeric, cantidad),
    fecha          = coalesce((p_cambios->>'fecha')::date, fecha),
    editada        = true
  where id = p_id
  returning * into v_despues;
  select kilos_referencia * v_despues.cantidad into v_kilos from public.envases where id = v_despues.envase_id;
  update public.entregas set kilos_estimados = coalesce(v_kilos, 0) where id = p_id returning * into v_despues;
  insert into public.auditoria_entregas(empresa_id, entrega_id, accion, motivo, antes, despues, usuario_nombre)
  values (v_emp, p_id, 'editar', trim(p_motivo), to_jsonb(v_antes), to_jsonb(v_despues),
          (select nombre from public.perfiles where user_id = auth.uid()));
end $$;

create or replace function public.anular_entrega(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.mi_empresa(); v_antes public.entregas%rowtype; v_despues public.entregas%rowtype;
begin
  if not public.es_admin() then raise exception 'Solo administradores pueden anular registros'; end if;
  if length(trim(coalesce(p_motivo,''))) < 3 then raise exception 'Debes indicar el motivo de la anulación'; end if;
  select * into v_antes from public.entregas where id = p_id and empresa_id = v_emp for update;
  if not found then raise exception 'Registro no encontrado'; end if;
  if v_antes.estado = 'X' then raise exception 'El registro ya está anulado'; end if;
  update public.entregas set estado = 'X', anulada_en = now(), anulada_por = auth.uid(), motivo_anulacion = trim(p_motivo)
    where id = p_id returning * into v_despues;
  insert into public.auditoria_entregas(empresa_id, entrega_id, accion, motivo, antes, despues, usuario_nombre)
  values (v_emp, p_id, 'anular', trim(p_motivo), to_jsonb(v_antes), to_jsonb(v_despues),
          (select nombre from public.perfiles where user_id = auth.uid()));
end $$;

create or replace function public.restaurar_entrega(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.mi_empresa(); v_antes public.entregas%rowtype; v_despues public.entregas%rowtype;
begin
  if not public.es_admin() then raise exception 'Solo administradores pueden restaurar registros'; end if;
  if length(trim(coalesce(p_motivo,''))) < 3 then raise exception 'Debes indicar el motivo'; end if;
  select * into v_antes from public.entregas where id = p_id and empresa_id = v_emp for update;
  if not found then raise exception 'Registro no encontrado'; end if;
  if v_antes.estado = 'A' then raise exception 'El registro ya está vigente'; end if;
  update public.entregas set estado = 'A', anulada_en = null, anulada_por = null, motivo_anulacion = null
    where id = p_id returning * into v_despues;
  insert into public.auditoria_entregas(empresa_id, entrega_id, accion, motivo, antes, despues, usuario_nombre)
  values (v_emp, p_id, case when v_antes.estado = 'D' then 'validar' else 'restaurar' end, trim(p_motivo), to_jsonb(v_antes), to_jsonb(v_despues),
          (select nombre from public.perfiles where user_id = auth.uid()));
end $$;

revoke execute on function public.editar_entrega(uuid,jsonb,text) from public, anon;
revoke execute on function public.anular_entrega(uuid,text) from public, anon;
revoke execute on function public.restaurar_entrega(uuid,text) from public, anon;
grant execute on function public.editar_entrega(uuid,jsonb,text) to authenticated;
grant execute on function public.anular_entrega(uuid,text) to authenticated;
grant execute on function public.restaurar_entrega(uuid,text) to authenticated;

create or replace view public.v_entregas_detalle with (security_invoker = true) as
select e.id, e.empresa_id, e.fecha, e.leido_en, e.estado, e.observacion,
       h.nombre as huerto, c.nombre as cuartel, va.nombre as variedad,
       en.nombre as envase, ca.nombre as calidad, tu.nombre as turno,
       co.nombre as contratista, cu.nombre as cuadrilla, p.nombre as jefe,
       t.rut, trim(t.nombres || ' ' || coalesce(t.apellido_paterno,'') || ' ' || coalesce(t.apellido_materno,'')) as trabajador,
       e.codigo_credencial, e.codigo_caja, e.cantidad, e.kilos_estimados,
       e.huerto_id, e.cuartel_id, e.envase_id, e.calidad_id, e.trabajador_id, e.contratista_id,
       coalesce((
         select ta.valor from public.tarifas ta
          where ta.empresa_id = e.empresa_id and ta.envase_id = e.envase_id
            and (ta.calidad_id is null or ta.calidad_id = e.calidad_id)
            and ta.vigente_desde <= e.fecha
          order by (ta.calidad_id is not null) desc, ta.vigente_desde desc limit 1
       ), 0) * e.cantidad as monto,
       e.editada, e.anulada_en, e.motivo_anulacion, pa.nombre as anulada_por_nombre, e.turno_id
  from public.entregas e
  join public.huertos h on h.id = e.huerto_id
  join public.cuarteles c on c.id = e.cuartel_id
  left join public.variedades va on va.id = e.variedad_id
  join public.envases en on en.id = e.envase_id
  left join public.calidades ca on ca.id = e.calidad_id
  left join public.turnos tu on tu.id = e.turno_id
  left join public.contratistas co on co.id = e.contratista_id
  left join public.cuadrillas cu on cu.id = e.cuadrilla_id
  left join public.perfiles p on p.user_id = e.jefe_user_id
  left join public.perfiles pa on pa.user_id = e.anulada_por
  join public.trabajadores t on t.id = e.trabajador_id;
