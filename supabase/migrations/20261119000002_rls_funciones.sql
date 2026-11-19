-- =========================================================
-- Seguridad (RLS), funciones de negocio y vistas
-- =========================================================

-- ---------- RLS ----------
alter table public.empresas enable row level security;
alter table public.perfiles enable row level security;

create policy empresas_sel on public.empresas for select to authenticated
  using (id = public.mi_empresa());

create policy perfiles_sel on public.perfiles for select to authenticated
  using (empresa_id = public.mi_empresa());
create policy perfiles_adm on public.perfiles for update to authenticated
  using (empresa_id = public.mi_empresa() and public.es_admin())
  with check (empresa_id = public.mi_empresa() and public.es_admin());

-- Maestros: todos los de la empresa leen, solo admin escribe
do $$
declare t text;
begin
  foreach t in array array['huertos','especies','variedades','cuarteles','envases','calidades','turnos',
    'contratistas','cuadrillas','tarifas','config_huerto','lotes_impresion','correlativos']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I_sel on public.%I for select to authenticated using (empresa_id = public.mi_empresa())', t, t);
    execute format('create policy %I_ins on public.%I for insert to authenticated with check (empresa_id = public.mi_empresa() and public.es_admin())', t, t);
    execute format('create policy %I_upd on public.%I for update to authenticated using (empresa_id = public.mi_empresa() and public.es_admin()) with check (empresa_id = public.mi_empresa() and public.es_admin())', t, t);
    execute format('create policy %I_del on public.%I for delete to authenticated using (empresa_id = public.mi_empresa() and public.es_admin())', t, t);
  end loop;
end $$;

-- Trabajadores y tarjetas: admin escribe; jefes asignan vía función asignar_credencial
alter table public.trabajadores enable row level security;
create policy trabajadores_sel on public.trabajadores for select to authenticated using (empresa_id = public.mi_empresa());
create policy trabajadores_ins on public.trabajadores for insert to authenticated with check (empresa_id = public.mi_empresa() and public.es_admin());
create policy trabajadores_upd on public.trabajadores for update to authenticated using (empresa_id = public.mi_empresa() and public.es_admin()) with check (empresa_id = public.mi_empresa() and public.es_admin());
create policy trabajadores_del on public.trabajadores for delete to authenticated using (empresa_id = public.mi_empresa() and public.es_admin());

alter table public.tarjetas enable row level security;
create policy tarjetas_sel on public.tarjetas for select to authenticated using (empresa_id = public.mi_empresa());
create policy tarjetas_ins on public.tarjetas for insert to authenticated with check (empresa_id = public.mi_empresa() and public.es_admin());
create policy tarjetas_upd on public.tarjetas for update to authenticated using (empresa_id = public.mi_empresa() and public.es_admin()) with check (empresa_id = public.mi_empresa() and public.es_admin());

-- Entregas: jefes y admin insertan en su empresa; solo admin modifica (anular)
alter table public.entregas enable row level security;
create policy entregas_sel on public.entregas for select to authenticated using (empresa_id = public.mi_empresa());
create policy entregas_ins on public.entregas for insert to authenticated
  with check (empresa_id = public.mi_empresa() and public.mi_rol() in ('admin','jefe') and jefe_user_id = auth.uid());
create policy entregas_upd on public.entregas for update to authenticated
  using (empresa_id = public.mi_empresa() and public.es_admin())
  with check (empresa_id = public.mi_empresa() and public.es_admin());

alter table public.asignaciones_credencial enable row level security;
create policy asig_sel on public.asignaciones_credencial for select to authenticated using (empresa_id = public.mi_empresa());

-- ---------- Validación RUT (módulo 11) ----------
create or replace function public.rut_valido(p_rut text) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  limpio text := upper(replace(replace(coalesce(p_rut,''), '.', ''), '-', ''));
  cuerpo text; dv text; suma int := 0; mult int := 2; i int; calc text;
begin
  if length(limpio) < 2 then return false; end if;
  cuerpo := left(limpio, length(limpio) - 1);
  dv := right(limpio, 1);
  if cuerpo !~ '^[0-9]+$' then return false; end if;
  for i in reverse length(cuerpo)..1 loop
    suma := suma + substr(cuerpo, i, 1)::int * mult;
    mult := case when mult = 7 then 2 else mult + 1 end;
  end loop;
  calc := (11 - (suma % 11))::text;
  if calc = '11' then calc := '0'; elsif calc = '10' then calc := 'K'; end if;
  return calc = dv;
end $$;

-- ---------- Generar tarjetas QR ----------
-- Formato compatible con el original: BC-<tipo>-<EE><correlativo 8 dígitos>
create or replace function public.generar_tarjetas(p_tipo char, p_cantidad int, p_descripcion text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.mi_empresa();
  v_cod smallint;
  v_desde bigint; v_hasta bigint; v_lote uuid;
begin
  if not public.es_admin() then raise exception 'Solo administradores pueden generar tarjetas'; end if;
  if p_tipo not in ('W','B') then raise exception 'Tipo inválido'; end if;
  if p_cantidad < 1 or p_cantidad > 5000 then raise exception 'Cantidad entre 1 y 5000'; end if;

  select codigo into v_cod from public.empresas where id = v_emp;

  insert into public.correlativos(empresa_id, tipo, ultimo) values (v_emp, p_tipo, 0)
    on conflict (empresa_id, tipo) do nothing;
  update public.correlativos set ultimo = ultimo + p_cantidad
    where empresa_id = v_emp and tipo = p_tipo
    returning ultimo - p_cantidad + 1, ultimo into v_desde, v_hasta;

  insert into public.lotes_impresion(empresa_id, tipo, descripcion, cantidad, desde, hasta)
    values (v_emp, p_tipo, p_descripcion, p_cantidad, v_desde, v_hasta) returning id into v_lote;

  insert into public.tarjetas(empresa_id, codigo, tipo, correlativo, lote_id)
  select v_emp,
         'BC-' || p_tipo || '-' || lpad(v_cod::text, 2, '0') || lpad(n::text, 8, '0'),
         p_tipo, n, v_lote
    from generate_series(v_desde, v_hasta) n;

  return v_lote;
end $$;

-- Importar códigos ya impresos (por ejemplo credenciales antiguas)
create or replace function public.importar_tarjetas(p_tipo char, p_codigos text[], p_descripcion text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.mi_empresa(); v_lote uuid; v_n int;
begin
  if not public.es_admin() then raise exception 'Solo administradores'; end if;
  insert into public.lotes_impresion(empresa_id, tipo, descripcion, cantidad)
    values (v_emp, p_tipo, coalesce(p_descripcion, 'Importación'), coalesce(array_length(p_codigos,1),0))
    returning id into v_lote;
  insert into public.tarjetas(empresa_id, codigo, tipo, lote_id, origen)
  select v_emp, upper(trim(c)), p_tipo, v_lote, 'importada'
    from unnest(p_codigos) c where trim(c) <> ''
  on conflict (codigo) do nothing;
  get diagnostics v_n = row_count;
  update public.lotes_impresion set cantidad = v_n where id = v_lote;
  return v_n;
end $$;

-- ---------- Asignar / liberar credencial (lo usa admin y jefes en terreno) ----------
-- Resultados: CR ok, DR el RUT ya tiene otra credencial, DC credencial en uso por otro,
--             CI credencial inexistente o anulada, RI rut inválido, TB trabajador bloqueado
create or replace function public.asignar_credencial(
  p_id uuid, p_codigo text, p_rut text, p_nombres text default null,
  p_apellido_paterno text default null, p_apellido_materno text default null,
  p_contratista_id uuid default null, p_extranjero boolean default false, p_forzar boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.mi_empresa();
  v_rut text := upper(replace(trim(p_rut), '.', ''));
  v_tar public.tarjetas%rowtype;
  v_trab public.trabajadores%rowtype;
  v_res text;
begin
  if public.mi_rol() not in ('admin','jefe') then raise exception 'Sin permiso'; end if;

  -- idempotencia (la misma operación puede llegar dos veces desde el teléfono)
  if exists (select 1 from public.asignaciones_credencial where id = p_id) then
    select resultado into v_res from public.asignaciones_credencial where id = p_id;
    return jsonb_build_object('resultado', v_res);
  end if;

  <<proc>>
  begin

  if not p_extranjero and not public.rut_valido(v_rut) then v_res := 'RI'; exit proc; end if;

  select * into v_tar from public.tarjetas where empresa_id = v_emp and codigo = upper(trim(p_codigo)) and tipo = 'W';
  if not found or v_tar.estado = 'anulada' then v_res := 'CI'; exit proc; end if;

  select * into v_trab from public.trabajadores where empresa_id = v_emp and rut = v_rut;
  if not found then
    if coalesce(trim(p_nombres),'') = '' then v_res := 'TN'; exit proc; end if; -- trabajador nuevo sin nombre
    insert into public.trabajadores(empresa_id, rut, extranjero, nombres, apellido_paterno, apellido_materno, contratista_id)
    values (v_emp, v_rut, p_extranjero, trim(p_nombres), nullif(trim(p_apellido_paterno),''), nullif(trim(p_apellido_materno),''), p_contratista_id)
    returning * into v_trab;
  end if;

  if v_trab.estado = 'B' then v_res := 'TB'; exit proc; end if;

  if v_tar.estado = 'asignada' and v_tar.trabajador_id = v_trab.id then v_res := 'CR'; exit proc; end if;
  if v_tar.estado = 'asignada' and v_tar.trabajador_id <> v_trab.id and not p_forzar then v_res := 'DC'; exit proc; end if;
  if exists (select 1 from public.tarjetas where trabajador_id = v_trab.id and estado = 'asignada' and tipo='W' and id <> v_tar.id) and not p_forzar then
    v_res := 'DR'; exit proc;
  end if;

  -- con forzar: libera la credencial anterior del trabajador y/o la quita al otro trabajador
  update public.tarjetas set estado = 'disponible', trabajador_id = null, asignada_en = null
    where empresa_id = v_emp and tipo = 'W' and estado = 'asignada' and trabajador_id = v_trab.id and id <> v_tar.id;
  update public.tarjetas set estado = 'asignada', trabajador_id = v_trab.id, asignada_en = now() where id = v_tar.id;
  if v_trab.estado = 'I' then update public.trabajadores set estado = 'A' where id = v_trab.id; end if;
  v_res := 'CR';
  end proc;

  insert into public.asignaciones_credencial(id, empresa_id, trabajador_id, codigo, accion, resultado)
    values (p_id, v_emp, v_trab.id, upper(trim(p_codigo)), 'asignar', v_res);
  return jsonb_build_object('resultado', v_res, 'trabajador_id', v_trab.id);
end $$;

create or replace function public.liberar_credencial(p_codigo text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.mi_empresa(); v_trab uuid; v_ok boolean;
begin
  if public.mi_rol() not in ('admin','jefe') then raise exception 'Sin permiso'; end if;
  update public.tarjetas set estado = 'disponible', trabajador_id = null, asignada_en = null
   where empresa_id = v_emp and codigo = upper(trim(p_codigo)) and estado = 'asignada'
   returning trabajador_id into v_trab;
  v_ok := found;
  insert into public.asignaciones_credencial(id, empresa_id, trabajador_id, codigo, accion, resultado)
    values (gen_random_uuid(), v_emp, v_trab, upper(trim(p_codigo)), 'liberar', case when v_ok then 'OK' else 'NF' end);
  return v_ok;
end $$;

-- ---------- Vistas de reportes ----------
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
       ), 0) * e.cantidad as monto
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
  join public.trabajadores t on t.id = e.trabajador_id;

grant select on public.v_entregas_detalle to authenticated;
grant execute on function public.generar_tarjetas(char,int,text) to authenticated;
grant execute on function public.importar_tarjetas(char,text[],text) to authenticated;
grant execute on function public.asignar_credencial(uuid,text,text,text,text,text,uuid,boolean,boolean) to authenticated;
grant execute on function public.liberar_credencial(text) to authenticated;
revoke execute on function public.generar_tarjetas(char,int,text) from anon;
revoke execute on function public.importar_tarjetas(char,text[],text) from anon;
revoke execute on function public.asignar_credencial(uuid,text,text,text,text,text,uuid,boolean,boolean) from anon;
revoke execute on function public.liberar_credencial(text) from anon;
