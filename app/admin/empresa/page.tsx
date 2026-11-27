'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { cargarTabla } from '@/lib/datos';
import { CAMPOS_EMPRESA, codigoEmpresa, Empresa, logoUrl } from '@/lib/empresa';
import { supabase } from '@/lib/supabase';
import { formatearRut, rutValido } from '@/lib/util';

type CampoE = { k: keyof Empresa; t: string; ayuda?: string; ancho?: 'full' };
const GENERALES: CampoE[] = [
  { k: 'nombre', t: 'Razón social *', ancho: 'full' },
  { k: 'nombre_corto', t: 'Nombre corto', ayuda: 'Se usa en el menú y encabezados cortos' },
  { k: 'rut', t: 'RUT' },
  { k: 'giro', t: 'Giro', ancho: 'full' },
  { k: 'direccion', t: 'Dirección', ancho: 'full' },
  { k: 'comuna', t: 'Comuna' },
  { k: 'ciudad', t: 'Ciudad' },
  { k: 'telefono', t: 'Teléfono' },
  { k: 'email', t: 'Correo' },
  { k: 'representante', t: 'Representante legal' },
];
const PREVENCION: CampoE[] = [
  { k: 'irl_razon_social', t: 'Nombre en la planilla IRL', ayuda: 'Vacío = razón social' },
  { k: 'riohs_razon_social', t: 'Nombre en el acuse del Reglamento Interno', ayuda: 'Vacío = razón social' },
  { k: 'prev_nombre', t: 'Encargado(a) de seguridad y salud' },
  { k: 'prev_cargo', t: 'Texto de firma del encargado(a)' },
  { k: 'prev_registro', t: 'N° de registro del encargado(a)' },
  { k: 'irl_codigo', t: 'Código del documento IRL' },
  { k: 'irl_version', t: 'Versión' },
  { k: 'irl_aprobacion', t: 'Fecha de aprobación', ayuda: 'Ej: ABRIL 2026' },
];
const EDITABLES = [...GENERALES, ...PREVENCION].map((c) => c.k);

export default function EmpresaPage() {
  const { perfil } = useAuth();
  const esAdmin = perfil?.rol === 'admin';
  const esSuper = !!perfil?.superadmin && esAdmin;
  const [e, setE] = useState<Empresa | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [msg, setMsg] = useState<{ t: string; m: string } | null>(null);

  async function cargar() {
    const [d] = await cargarTabla<Empresa>('empresas', CAMPOS_EMPRESA, (q) => q.eq('id', perfil!.empresa_id));
    setE(d || null);
  }
  useEffect(() => { if (perfil) cargar(); }, [perfil?.empresa_id]); // eslint-disable-line

  /** El menú y los informes leen la empresa del perfil guardado: lo refresco recargando la página */
  const refrescarPerfil = () => { localStorage.removeItem('cosecha-perfil'); location.reload(); };

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!e) return;
    if (!e.nombre?.trim()) { setMsg({ t: 'error', m: 'La razón social es obligatoria.' }); return; }
    const rut = (e.rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
    if (rut && !rutValido(rut)) { setMsg({ t: 'error', m: 'El RUT no es válido.' }); return; }
    setGuardando(true); setMsg(null);
    const cambios: any = {};
    for (const k of EDITABLES) { const v = (e as any)[k]; cambios[k] = typeof v === 'string' ? v.trim() || null : v ?? null; }
    cambios.rut = rut || null;
    const { error } = await supabase.from('empresas').update(cambios).eq('id', e.id);
    setGuardando(false);
    if (error) { setMsg({ t: 'error', m: error.message }); return; }
    setMsg({ t: 'ok', m: 'Datos guardados.' });
    setTimeout(refrescarPerfil, 700);
  }

  async function subirLogo(file: File) {
    if (!e) return;
    if (file.size > 2 * 1024 * 1024) { setMsg({ t: 'error', m: 'El logo debe pesar menos de 2 MB.' }); return; }
    setSubiendo(true); setMsg(null);
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const ruta = `${e.id}/logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('empresa-logos').upload(ruta, file, { upsert: true, contentType: file.type });
    if (error) { setSubiendo(false); setMsg({ t: 'error', m: error.message }); return; }
    const anterior = e.logo_path;
    const { error: e2 } = await supabase.from('empresas').update({ logo_path: ruta }).eq('id', e.id);
    if (!e2 && anterior) await supabase.storage.from('empresa-logos').remove([anterior]);
    setSubiendo(false);
    if (e2) { setMsg({ t: 'error', m: e2.message }); return; }
    setE({ ...e, logo_path: ruta });
    setMsg({ t: 'ok', m: 'Logo actualizado.' });
  }

  async function quitarLogo() {
    if (!e?.logo_path || !confirm('¿Quitar el logo?')) return;
    await supabase.from('empresas').update({ logo_path: null }).eq('id', e.id);
    await supabase.storage.from('empresa-logos').remove([e.logo_path]);
    setE({ ...e, logo_path: null });
  }

  const campo = (c: CampoE) => (
    <div key={c.k} className="campo" style={c.ancho === 'full' ? { flexBasis: '100%' } : undefined}>
      <label>{c.t}</label>
      <input value={(c.k === 'rut' && e?.rut && !/[.-]/.test(e.rut) ? formatearRut(e.rut) : ((e as any)?.[c.k] ?? ''))} disabled={!esAdmin}
        onChange={(ev) => setE({ ...e!, [c.k]: ev.target.value })} />
      {c.ayuda && <div className="muted" style={{ fontSize: '.78rem', marginTop: '.15rem' }}>{c.ayuda}</div>}
    </div>
  );

  if (!e) return <div><h1>Empresa</h1><p className="muted">Cargando…</p></div>;
  const logo = logoUrl(e);

  return (
    <div>
      <div className="encabezado">
        <h1>Empresa</h1>
        <span className="badge" title="Los teléfonos de campo y acopio usan este código al registrarse">Código para equipos: <b>{codigoEmpresa(e)}</b></span>
      </div>

      <form onSubmit={guardar}>
        <section className="tarjeta">
          <h3 style={{ marginTop: 0 }}>Datos de la empresa</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: '.88rem' }}>Aparecen en el menú, el Informe cosecha diaria, las proformas y las planillas de ingreso de personal.</p>
          <div className="fila">{GENERALES.map(campo)}</div>

          <div className="logo-empresa">
            <div className="logo-caja">{logo ? <img src={logo} alt="Logo" /> : <span className="muted">Sin logo</span>}</div>
            {esAdmin && (
              <div>
                <label className="boton-archivo">
                  {subiendo ? 'Subiendo…' : logo ? 'Cambiar logo' : 'Subir logo'}
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden disabled={subiendo}
                    onChange={(ev) => { const f = ev.target.files?.[0]; if (f) subirLogo(f); ev.target.value = ''; }} />
                </label>
                {logo && <button type="button" className="chico" style={{ marginLeft: '.5rem' }} onClick={quitarLogo}>Quitar</button>}
                <div className="muted" style={{ fontSize: '.78rem', marginTop: '.3rem' }}>PNG, JPG, WEBP o SVG, máximo 2 MB. Se usa en la planilla IRL.</div>
              </div>
            )}
          </div>
        </section>

        <section className="tarjeta">
          <h3 style={{ marginTop: 0 }}>Prevención de riesgos (IRL y Reglamento Interno)</h3>
          <div className="fila">{PREVENCION.map(campo)}</div>
        </section>

        {msg && <div className={`alerta ${msg.t}`}>{msg.m}</div>}
        {esAdmin && <button className="primario" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar datos de la empresa'}</button>}
      </form>

      {esSuper && <Empresas actual={e.id} />}
    </div>
  );
}

/** Solo superadministrador: listado de empresas, crear una nueva y cambiarse de empresa */
function Empresas({ actual }: { actual: string }) {
  const [lista, setLista] = useState<Empresa[]>([]);
  const [nueva, setNueva] = useState({ nombre: '', rut: '', email: '', admin: '', copiar: true });
  const [msg, setMsg] = useState<{ t: string; m: string } | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const cargar = () => cargarTabla<Empresa>('empresas', 'id,codigo,nombre,nombre_corto,rut,activa', undefined, 'codigo').then(setLista).catch(() => {});
  useEffect(() => { cargar(); }, []);

  async function crear(ev: React.FormEvent) {
    ev.preventDefault();
    const rut = nueva.rut.replace(/[^0-9kK]/g, '');
    if (rut && !rutValido(rut)) { setMsg({ t: 'error', m: 'El RUT no es válido.' }); return; }
    setTrabajando(true); setMsg(null);
    const { data, error } = await supabase.rpc('crear_empresa', {
      p_nombre: nueva.nombre, p_rut: rut, p_admin_email: nueva.email, p_admin_nombre: nueva.admin, p_copiar_catalogos: nueva.copiar,
    });
    setTrabajando(false);
    if (error) { setMsg({ t: 'error', m: error.message }); return; }
    const r = Array.isArray(data) ? data[0] : data;
    setMsg({ t: 'ok', m: `Empresa creada con código ${String(r.codigo).padStart(2, '0')}.${nueva.email ? ` Pide a ${nueva.admin || nueva.email} que entre a ${location.origin} y cree su cuenta con ${nueva.email}; quedará como administrador.` : ''}` });
    setNueva({ nombre: '', rut: '', email: '', admin: '', copiar: true });
    cargar();
  }

  async function cambiar(emp: Empresa) {
    if (!confirm(`¿Trabajar ahora en ${emp.nombre}? Verás solo sus datos hasta que vuelvas a cambiar.`)) return;
    const { error } = await supabase.rpc('cambiar_empresa', { p_empresa: emp.id });
    if (error) { setMsg({ t: 'error', m: error.message }); return; }
    localStorage.removeItem('cosecha-perfil');
    location.href = '/admin/';
  }

  return (
    <section className="tarjeta" style={{ marginTop: '1.5rem' }}>
      <h3 style={{ marginTop: 0 }}>Empresas <span className="badge">superadministrador</span></h3>
      <div className="tabla-wrap">
        <table>
          <thead><tr><th>Código</th><th>Razón social</th><th>RUT</th><th></th></tr></thead>
          <tbody>
            {lista.map((x) => (
              <tr key={x.id}>
                <td className="mono">{codigoEmpresa(x)}</td>
                <td>{x.nombre}{x.nombre_corto ? <span className="muted"> · {x.nombre_corto}</span> : null}</td>
                <td>{x.rut ? formatearRut(x.rut) : ''}</td>
                <td>{x.id === actual ? <span className="badge ok">Actual</span> : <button className="chico" onClick={() => cambiar(x)}>Trabajar en esta</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 style={{ margin: '1.2rem 0 .5rem' }}>Nueva empresa</h4>
      <form onSubmit={crear}>
        <div className="fila">
          <div className="campo" style={{ flexBasis: '100%' }}><label>Razón social *</label><input required value={nueva.nombre} onChange={(ev) => setNueva({ ...nueva, nombre: ev.target.value })} /></div>
          <div className="campo"><label>RUT</label><input value={nueva.rut} onChange={(ev) => setNueva({ ...nueva, rut: ev.target.value })} /></div>
          <div className="campo"><label>Correo del administrador</label><input type="email" value={nueva.email} onChange={(ev) => setNueva({ ...nueva, email: ev.target.value })} /></div>
          <div className="campo"><label>Nombre del administrador</label><input value={nueva.admin} onChange={(ev) => setNueva({ ...nueva, admin: ev.target.value })} /></div>
        </div>
        <label style={{ display: 'flex', gap: '.4rem', alignItems: 'center', margin: '.2rem 0 .8rem' }}>
          <input type="checkbox" checked={nueva.copiar} onChange={(ev) => setNueva({ ...nueva, copiar: ev.target.checked })} />
          Copiar especies, variedades, calidades, turnos y envases de la empresa actual
        </label>
        {msg && <div className={`alerta ${msg.t}`}>{msg.m}</div>}
        <button className="primario" disabled={trabajando}>{trabajando ? 'Creando…' : 'Crear empresa'}</button>
      </form>
      <p className="muted" style={{ fontSize: '.82rem', marginBottom: 0 }}>
        El correo del administrador debe ser de una cuenta nueva (cada cuenta pertenece a una empresa). Huertos, tarifas, trabajadores y usuarios se configuran dentro de cada empresa.
      </p>
    </section>
  );
}
