-- Las funciones SECURITY DEFINER no deben ser ejecutables sin sesión.
-- Las RPC que quedan para "authenticated" validan rol internamente.
revoke execute on function public.mi_empresa() from public, anon;
revoke execute on function public.mi_rol() from public, anon;
revoke execute on function public.es_admin() from public, anon;
grant execute on function public.mi_empresa() to authenticated;
grant execute on function public.mi_rol() to authenticated;
grant execute on function public.es_admin() to authenticated;
revoke execute on function public.generar_tarjetas(char,int,text) from public, anon;
revoke execute on function public.importar_tarjetas(char,text[],text) from public, anon;
revoke execute on function public.asignar_credencial(uuid,text,text,text,text,text,uuid,boolean,boolean) from public, anon;
revoke execute on function public.liberar_credencial(text) from public, anon;
revoke execute on function public.tg_entrega_duplicada() from public, anon, authenticated;
revoke execute on function public.tg_nuevo_usuario() from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;
