-- El perfil administrativo también asigna y libera credenciales (desde Ingreso de personal)
do $m$
declare d text;
begin
  d := pg_get_functiondef('public.asignar_credencial(uuid,text,text,text,text,text,uuid,boolean,boolean,boolean)'::regprocedure);
  if position($q$not in ('admin','jefe')$q$ in d) = 0 then raise exception 'asignar_credencial: no se encontró el control de rol'; end if;
  execute replace(d, $q$not in ('admin','jefe')$q$, $q$not in ('admin','jefe','administrativo')$q$);
  d := pg_get_functiondef('public.liberar_credencial(text)'::regprocedure);
  if position($q$not in ('admin','jefe')$q$ in d) = 0 then raise exception 'liberar_credencial: no se encontró el control de rol'; end if;
  execute replace(d, $q$not in ('admin','jefe')$q$, $q$not in ('admin','jefe','administrativo')$q$);
end $m$;
