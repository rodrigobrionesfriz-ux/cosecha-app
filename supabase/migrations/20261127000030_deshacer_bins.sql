-- Deshacer en acopio: quitar un bin de un despacho y deshacer una recepción.
--   quitar_despacho: el bin vuelve a "recibido" (o "enfriado" si pasó por cámara) y queda fuera del despacho.
--   deshacer_recepcion: si el bin venía de campo vuelve a "cerrado"; si se creó al recibir o armar en acopio, se anula
--   para que la etiqueta quede libre. En ambos casos se descartan conciliaciones pendientes.
alter table public.eventos_bin drop constraint if exists eventos_bin_tipo_check;
alter table public.eventos_bin add constraint eventos_bin_tipo_check
  check (tipo in ('abrir','cerrar','armar','recibir','camara_entrada','camara_salida','despachar','anular','quitar_despacho','deshacer_recepcion'));

do $$
declare
  src text;
  ancla text := E'  select * into b from public.bins\n   where empresa_id = new.empresa_id and codigo = new.codigo and estado not in (''despachado'',''anulado'')';
  bloque text := $b$
  -- ===== Deshacer (acopio) =====
  if new.tipo in ('quitar_despacho', 'deshacer_recepcion') then
    if v_rol not in ('admin','acopio') then new.resultado := 'SP'; new.mensaje := 'Solo acopio o administración'; return new; end if;
    if new.tipo = 'quitar_despacho' then
      select * into r from public.bins
       where empresa_id = new.empresa_id and codigo = new.codigo and estado = 'despachado' and despacho_id = (d->>'despacho_id')::uuid
       order by despachado_en desc limit 1 for update;
      if not found then new.resultado := 'NF'; new.mensaje := 'El bin no está en ese despacho'; return new; end if;
      if exists (select 1 from public.bins x where x.empresa_id = new.empresa_id and x.codigo = new.codigo and x.estado not in ('despachado','anulado')) then
        new.resultado := 'EA'; new.mensaje := 'La etiqueta ya está en otra vuelta'; new.bin_aplicado := r.id; return new;
      end if;
      update public.bins set estado = case when camara_id is not null then 'enfriado' else 'recibido' end,
        despacho_id = null, despachado_en = null, updated_at = now() where id = r.id;
      new.resultado := 'OK'; new.bin_aplicado := r.id; return new;
    end if;
    -- deshacer_recepcion
    select * into r from public.bins where empresa_id = new.empresa_id and codigo = new.codigo and estado = 'recibido' for update;
    if not found then new.resultado := 'NF'; new.mensaje := 'El bin no está recibido (puede estar en cámara o despachado)'; return new; end if;
    if r.origen = 'campo' then
      update public.bins set estado = 'cerrado', recibido_en = null, recibido_por = null, recibido_operador_id = null,
        acopio_huerto_id = null, acopio_cuartel_id = null, acopio_variedad_id = null, acopio_envases = null,
        calidad = '{}'::jsonb, fotos = '{}', updated_at = now() where id = r.id;
    else
      update public.bins set estado = 'anulado', observacion = coalesce(observacion || ' | ', '') || 'Recepción deshecha', updated_at = now() where id = r.id;
    end if;
    update public.conciliaciones_bin set estado = 'descartada', resuelto_en = now(), resuelto_por = new.hecho_por, nota = 'Recepción deshecha'
     where bin_id = r.id and estado = 'pendiente';
    new.resultado := 'OK'; new.bin_aplicado := r.id; return new;
  end if;

$b$;
begin
  select pg_get_functiondef('public.tg_evento_bin'::regproc) into src;
  if position(ancla in src) = 0 then raise exception 'No se encontró el punto de inserción en tg_evento_bin'; end if;
  if position('quitar_despacho' in src) > 0 then return; end if; -- ya aplicado
  execute replace(src, ancla, bloque || ancla);
end $$;
