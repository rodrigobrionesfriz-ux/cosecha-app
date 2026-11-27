import { supabase } from './supabase';
import { formatearRut } from './util';

/** Datos configurables de la empresa (tabla empresas) */
export type Empresa = {
  id: string; codigo: number; nombre: string; rut?: string | null; activa?: boolean;
  nombre_corto?: string | null; giro?: string | null; direccion?: string | null; comuna?: string | null; ciudad?: string | null;
  telefono?: string | null; email?: string | null; representante?: string | null; logo_path?: string | null;
  irl_razon_social?: string | null; riohs_razon_social?: string | null;
  prev_nombre?: string | null; prev_cargo?: string | null; prev_registro?: string | null;
  irl_codigo?: string | null; irl_version?: string | null; irl_aprobacion?: string | null;
};

export const CAMPOS_EMPRESA = 'id,codigo,nombre,rut,activa,nombre_corto,giro,direccion,comuna,ciudad,telefono,email,representante,logo_path,irl_razon_social,riohs_razon_social,prev_nombre,prev_cargo,prev_registro,irl_codigo,irl_version,irl_aprobacion';

/** URL pública del logo (bucket empresa-logos) o null */
export function logoUrl(e?: Pick<Empresa, 'logo_path'> | null): string | null {
  if (!e?.logo_path) return null;
  return supabase.storage.from('empresa-logos').getPublicUrl(e.logo_path).data.publicUrl;
}

export const rutEmpresa = (e?: Pick<Empresa, 'rut'> | null) => (e?.rut ? formatearRut(e.rut) : '');
export const codigoEmpresa = (e?: Pick<Empresa, 'codigo'> | null) => String(e?.codigo ?? '').padStart(2, '0');
