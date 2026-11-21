-- Al asignar credencial el jefe elige el contratista (o propio/interno).
-- Para un trabajador que ya existe, p_actualiza_contratista = true cambia su contratista (null = propio).
drop function public.asignar_credencial(uuid,text,text,text,text,text,uuid,boolean,boolean);

create function public.asignar_credencial(
  p_id uuid, p_codigo text, p_rut text,
  p_nombres text default null, p_apellido_paterno text default null, p_apellido_materno text default null,
  p_contratista_id uuid default null, p_extranjero boolean default false, p_forzar boolean default false,
  p_actualiza_contratista boolean default false)
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

  if exists (select 1 from public.asignaciones_credencial where id = p_id) then
    select resultado into v_res from public.asignaciones_credencial where id = p_id;
    return jsonb_build_object('resultado', v_res);
  end if;

  if p_contratista_id is not null and not exists (select 1 from public.contratistas where id = p_contratista_id and empresa_id = v_emp) then
    raise exception 'Contratista no válido';
  end if;

  <<proc>>
  begin

  if not p_extranjero and not public.rut_valido(v_rut) then v_res := 'RI'; exit proc; end if;

  select * into v_tar from public.tarjetas where empresa_id = v_emp and codigo = upper(trim(p_codigo)) and tipo = 'W';
  if not found or v_tar.estado = 'anulada' then v_res := 'CI'; exit proc; end if;

  select * into v_trab from public.trabajadores where empresa_id = v_emp and rut = v_rut;
  if not found then
    if coalesce(trim(p_nombres),'') = '' then v_res := 'TN'; exit proc; end if;
    insert into public.trabajadores(empresa_id, rut, extranjero, nombres, apellido_paterno, apellido_materno, contratista_id)
    values (v_emp, v_rut, p_extranjero, trim(p_nombres), nullif(trim(p_apellido_paterno),''), nullif(trim(p_apellido_materno),''), p_contratista_id)
    returning * into v_trab;
  end if;

  if v_trab.estado = 'B' then v_res := 'TB'; exit proc; end if;

  if p_actualiza_contratista and v_trab.contratista_id is distinct from p_contratista_id then
    update public.trabajadores set contratista_id = p_contratista_id where id = v_trab.id;
  end if;

  if v_tar.estado = 'asignada' and v_tar.trabajador_id = v_trab.id then v_res := 'CR'; exit proc; end if;
  if v_tar.estado = 'asignada' and v_tar.trabajador_id <> v_trab.id and not p_forzar then v_res := 'DC'; exit proc; end if;
  if exists (select 1 from public.tarjetas where trabajador_id = v_trab.id and estado = 'asignada' and tipo='W' and id <> v_tar.id) and not p_forzar then
    v_res := 'DR'; exit proc;
  end if;

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

revoke execute on function public.asignar_credencial(uuid,text,text,text,text,text,uuid,boolean,boolean,boolean) from public, anon;
grant execute on function public.asignar_credencial(uuid,text,text,text,text,text,uuid,boolean,boolean,boolean) to authenticated;
