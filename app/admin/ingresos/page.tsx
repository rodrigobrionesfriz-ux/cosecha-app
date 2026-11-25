'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { cargarTabla, errorAmigable, useTabla } from '@/lib/datos';
import { formatearRut, hoyISO, normalizarRut, rutValido } from '@/lib/util';
import { leerCedula } from '@/lib/cedula';
import { leerReverso } from '@/lib/mrz';
import { celularVisible, excelIngresos, fechaCorta, Ficha, pdfIngresos } from '@/lib/ingresos';
import CapturaQR from '@/components/CapturaQR';
import AsignarCredencial from '@/components/AsignarCredencial';

const PARENTESCOS = ['Madre', 'Padre', 'Cónyuge', 'Pareja', 'Hijo(a)', 'Hermano(a)', 'Abuelo(a)', 'Tío(a)', 'Amigo(a)', 'Otro'];
const PROPIO = 'propio';

type Form = {
  rut: string; extranjero: boolean; nombres: string; apellido_paterno: string; apellido_materno: string;
  fecha_nacimiento: string; sexo: string; nacionalidad: string; mrz_texto: string; cedula_serie: string; cedula_vencimiento: string; qr_texto: string;
  direccion: string; comuna: string; contratista: string; // '' = sin elegir, 'propio' = interno
  contacto_nombre: string; contacto_parentesco: string; celular8: string; fecha_ingreso: string; observacion: string;
};
const vacio = (): Form => ({
  rut: '', extranjero: false, nombres: '', apellido_paterno: '', apellido_materno: '', fecha_nacimiento: '', sexo: '', nacionalidad: '', mrz_texto: '', cedula_serie: '',
  cedula_vencimiento: '', qr_texto: '', direccion: '', comuna: '', contratista: '', contacto_nombre: '', contacto_parentesco: '',
  celular8: '', fecha_ingreso: hoyISO(), observacion: '',
});
const desdeFicha = (f: Ficha): Form => ({
  rut: f.extranjero ? f.rut : formatearRut(f.rut), extranjero: f.extranjero, nombres: f.nombres, apellido_paterno: f.apellido_paterno ?? '',
  apellido_materno: f.apellido_materno ?? '', fecha_nacimiento: f.fecha_nacimiento ?? '', sexo: f.sexo ?? '', nacionalidad: f.nacionalidad ?? '',
  mrz_texto: f.mrz_texto ?? '', cedula_serie: f.cedula_serie ?? '',
  cedula_vencimiento: f.cedula_vencimiento ?? '', qr_texto: f.qr_texto ?? '', direccion: f.direccion ?? '', comuna: f.comuna ?? '',
  contratista: f.contratista_id ?? PROPIO, contacto_nombre: f.contacto_nombre ?? '', contacto_parentesco: f.contacto_parentesco ?? '',
  celular8: (f.contacto_celular ?? '').replace(/^\+569/, ''), fecha_ingreso: f.fecha_ingreso, observacion: f.observacion ?? '',
});

export default function Ingresos() {
  const [vista, setVista] = useState<'nuevo' | 'listado'>('nuevo');
  const [editar, setEditar] = useState<Ficha | null>(null);
  const [completarRut, setCompletarRut] = useState('');
  const [version, setVersion] = useState(0);
  const contr = useTabla<any>('contratistas', 'id,nombre,rut,activo', 'nombre');
  const contratistas = contr.filas.filter((c) => c.activo !== false);

  return (
    <div>
      <div className="encabezado"><h1>Ingreso de personal</h1></div>
      <div className="tabs no-print">
        <button className={vista === 'nuevo' ? 'activo' : ''} onClick={() => setVista('nuevo')}>{editar ? 'Editar ingreso' : 'Nuevo ingreso'}</button>
        <button className={vista === 'listado' ? 'activo' : ''} onClick={() => setVista('listado')}>Listado y reportes</button>
      </div>
      {vista === 'nuevo'
        ? <Formulario key={editar?.id ?? 'nuevo-' + version + completarRut} inicial={editar} rutInicial={completarRut} contratistas={contratistas}
            onNuevo={() => { setEditar(null); setCompletarRut(''); setVersion((v) => v + 1); }} />
        : <Listado contratistas={contratistas} onEditar={(f) => { setEditar(f); setCompletarRut(''); setVista('nuevo'); }}
            onCompletar={(rut) => { setEditar(null); setCompletarRut(rut); setVista('nuevo'); }} />}
    </div>
  );
}

/** Dibujo del reverso del carnet: QR, huella y las 3 líneas de lectura mecánica */
function IconoReverso() {
  const qr = [[0,0],[1,0],[2,0],[0,1],[2,1],[0,2],[1,2],[2,2],[4,0],[5,1],[4,2],[3,3],[5,3],[0,4],[2,4],[4,4],[1,5],[3,5],[5,5],[0,6],[2,6],[4,6],[6,6],[6,0],[6,2],[6,4]];
  return (
    <svg width="96" height="62" viewBox="0 0 96 62" aria-label="Reverso del carnet" role="img">
      <rect x="1" y="1" width="94" height="60" rx="6" fill="#f3e6cf" stroke="#b9925f" strokeWidth="1.5" />
      <rect x="7" y="6" width="26" height="26" rx="2" fill="#fff" stroke="#c9b08a" />
      {qr.map(([x, y], i) => <rect key={i} x={9 + x * 3.2} y={8 + y * 3.2} width="3.2" height="3.2" fill="#2b2b2b" />)}
      <g fill="none" stroke="#8a6a45" strokeWidth="1.1" strokeLinecap="round">
        <ellipse cx="78" cy="19" rx="9" ry="11" />
        <ellipse cx="78" cy="19.5" rx="6" ry="8" />
        <ellipse cx="78" cy="20" rx="3.2" ry="4.8" />
        <path d="M78 17.5v4" />
      </g>
      <rect x="38" y="8" width="28" height="3" rx="1.5" fill="#cdb48f" />
      <rect x="38" y="15" width="22" height="3" rx="1.5" fill="#cdb48f" />
      <rect x="38" y="22" width="25" height="3" rx="1.5" fill="#cdb48f" />
      <rect x="4" y="36" width="88" height="22" rx="2" fill="#fffaf0" />
      <g fontFamily="monospace" fontSize="6.4" fontWeight="700" fill="#2b2b2b" letterSpacing="0.2">
        <text x="6" y="42.5">IDCHL1023&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;</text>
        <text x="6" y="49.5">8702144M2702&lt;&lt;&lt;&lt;&lt;&lt;&lt;</text>
        <text x="6" y="56.5">PEREZ&lt;SOTO&lt;&lt;JUAN&lt;&lt;&lt;&lt;</text>
      </g>
      <rect x="4" y="36" width="88" height="22" rx="2" fill="none" stroke="#b3192f" strokeWidth="1.2" strokeDasharray="3 2" />
    </svg>
  );
}

// ---------------------------------------------------------------- Formulario
function Formulario({ inicial, rutInicial, contratistas, onNuevo }: { inicial: Ficha | null; rutInicial?: string; contratistas: any[]; onNuevo: () => void }) {
  const [f, setF] = useState<Form>(inicial ? desdeFicha(inicial) : vacio());
  const [msg, setMsg] = useState<{ t: 'ok' | 'error' | 'aviso' | 'info'; m: string } | null>(null);
  const [guardado, setGuardado] = useState<string | null>(inicial?.trabajador_id ?? null); // trabajador_id
  const [cambios, setCambios] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const set = (k: keyof Form, v: any) => { setF((x) => ({ ...x, [k]: v })); setCambios(true); };

  const rutOk = f.extranjero ? f.rut.trim().length >= 3 : rutValido(f.rut);
  const celOk = /^\d{8}$/.test(f.celular8);
  const vencido = f.cedula_vencimiento && f.cedula_vencimiento < hoyISO();

  // Estado visual de cada campo: verde = listo, rojo = el siguiente obligatorio (o uno obligatorio que se dejó vacío)
  const validos: Record<string, boolean> = {
    rut: rutOk, nombres: !!f.nombres.trim(), apellido_paterno: !!f.apellido_paterno.trim(), fecha_ingreso: !!f.fecha_ingreso,
    direccion: !!f.direccion.trim(), contratista: !!f.contratista, contacto_nombre: !!f.contacto_nombre.trim(),
    contacto_parentesco: !!f.contacto_parentesco.trim(), celular8: celOk,
  };
  const siguiente = Object.keys(validos).find((k) => !validos[k]);
  const faltan = Object.values(validos).filter((v) => !v).length;
  const [tocados, setTocados] = useState<Set<string>>(new Set());
  const tb = (k: string) => () => setTocados((x) => (x.has(k) ? x : new Set(x).add(k)));
  const ec = (k: string) => {
    if (k === 'cedula_vencimiento' && vencido) return 'campo est-falta';
    if (k in validos) {
      if (validos[k]) return 'campo est-ok';
      if (k === siguiente) return 'campo est-falta est-sig';
      return tocados.has(k) ? 'campo est-falta' : 'campo';
    }
    return (f as any)[k] ? 'campo est-ok' : 'campo';
  };

  /** Al tener el RUT, completar con lo que ya exista (trabajador y ficha) */
  async function buscarExistente(rut: string, extra?: Partial<Form>) {
    const r = normalizarRut(rut);
    const [t] = await cargarTabla<any>('trabajadores', 'id,nombres,apellido_paterno,apellido_materno,contratista_id', (q) => q.eq('rut', r));
    if (!t) { setMsg({ t: 'info', m: 'Trabajador nuevo. Completa los nombres: el QR del carnet no los trae.' }); return; }
    const [fi] = await cargarTabla<Ficha>('v_fichas_ingreso', '*', (q) => q.eq('trabajador_id', t.id));
    setF((x) => {
      const base = fi ? desdeFicha(fi) : { ...x, nombres: t.nombres, apellido_paterno: t.apellido_paterno ?? '', apellido_materno: t.apellido_materno ?? '', contratista: t.contratista_id ?? x.contratista };
      // lo recién leído del carnet manda sobre lo guardado
      return { ...base, ...Object.fromEntries(Object.entries(extra || {}).filter(([, v]) => v)), rut: formatearRut(r) };
    });
    setGuardado(fi ? t.id : null);
    setMsg({ t: 'aviso', m: fi ? `Este trabajador ya tiene ficha de ingreso (${fechaCorta(fi.fecha_ingreso)}). Revisa los datos y guarda para actualizarla.` : 'Trabajador ya registrado en el sistema: se completaron sus nombres. Falta su ficha de ingreso.' });
  }

  function alLeer(texto: string) {
    const d = leerCedula(texto);
    if (!d?.rut) { setMsg({ t: 'error', m: 'No reconocí el código. Escanea el QR del reverso del carnet.' }); return false; }
    const extra: Partial<Form> = {
      fecha_nacimiento: d.nacimiento ?? '', cedula_serie: d.serie ?? '', cedula_vencimiento: d.vencimiento ?? '', qr_texto: d.texto,
    };
    setF((x) => ({ ...x, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v)), rut: formatearRut(d.rut!), extranjero: false }));
    setCambios(true);
    buscarExistente(d.rut, extra);
    return true;
  }

  const [leyendo, setLeyendo] = useState<{ p: number; t: string } | null>(null);
  async function fotoReverso(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMsg(null); setLeyendo({ p: 0, t: 'Abriendo foto…' });
    try {
      const d = await leerReverso(file, (p, t) => setLeyendo({ p, t }));
      if (!d.rut && !d.nombres) { setMsg({ t: 'error', m: d.avisos.join(' ') }); return; }
      const extra: Partial<Form> = {
        nombres: d.nombres, apellido_paterno: d.apellido_paterno, apellido_materno: d.apellido_materno, sexo: d.sexo ?? '',
        nacionalidad: d.nacionalidad ?? '', fecha_nacimiento: d.nacimiento ?? '', cedula_serie: d.serie ?? '',
        cedula_vencimiento: d.vencimiento ?? '', qr_texto: d.qr?.texto ?? '', mrz_texto: d.mrz?.join('\n') ?? '',
      };
      const lleno = Object.fromEntries(Object.entries(extra).filter(([, v]) => v));
      setF((x) => ({ ...x, ...lleno, ...(d.rut ? { rut: formatearRut(d.rut), extranjero: false } : {}) }));
      setCambios(true);
      let yaExiste = false;
      if (d.rut) {
        // si ya existe, se conserva lo guardado (con tildes y ñ) y se actualiza lo leído del carnet
        const r0 = normalizarRut(d.rut);
        const [t] = await cargarTabla<any>('trabajadores', 'id', (q) => q.eq('rut', r0));
        yaExiste = !!t;
        if (t) await buscarExistente(d.rut, Object.fromEntries(Object.entries(extra).filter(([k, v]) => v && !['nombres', 'apellido_paterno', 'apellido_materno'].includes(k))) as Partial<Form>);
      }
      setMsg({ t: d.verificado ? 'ok' : 'aviso', m: (d.verificado ? 'Carnet leído y verificado. ' : '') + (yaExiste ? 'Trabajador ya registrado: se mantienen sus nombres guardados; revisa su ficha. ' : d.avisos.join(' ')) + (d.rut ? '' : ' No se pudo leer el RUT: escríbelo.') });
    } catch (err: any) {
      setMsg({ t: 'error', m: 'No se pudo leer la foto: ' + (err?.message || err) });
    } finally { setLeyendo(null); }
  }

  async function guardar(e?: React.FormEvent) {
    e?.preventDefault();
    if (!rutOk) return setMsg({ t: 'error', m: 'RUT inválido.' });
    if (!f.nombres.trim() || !f.apellido_paterno.trim()) return setMsg({ t: 'error', m: 'Faltan nombres o apellido paterno.' });
    if (!f.direccion.trim()) return setMsg({ t: 'error', m: 'Falta la dirección particular.' });
    if (!f.contratista) return setMsg({ t: 'error', m: 'Selecciona el contratista (o Propio / interno).' });
    if (!f.contacto_nombre.trim() || !f.contacto_parentesco.trim()) return setMsg({ t: 'error', m: 'Falta el nombre o el parentesco del contacto.' });
    if (!celOk) return setMsg({ t: 'error', m: 'El celular de contacto debe tener los 8 dígitos después del +569.' });
    setOcupado(true);
    const { data, error } = await supabase.rpc('registrar_ingreso', {
      p: {
        rut: f.extranjero ? f.rut.trim().toUpperCase() : normalizarRut(f.rut), extranjero: f.extranjero,
        nombres: f.nombres, apellido_paterno: f.apellido_paterno, apellido_materno: f.apellido_materno,
        fecha_nacimiento: f.fecha_nacimiento, sexo: f.sexo, nacionalidad: f.nacionalidad, mrz_texto: f.mrz_texto, cedula_serie: f.cedula_serie, cedula_vencimiento: f.cedula_vencimiento, qr_texto: f.qr_texto,
        direccion: f.direccion, comuna: f.comuna, contratista_id: f.contratista === PROPIO ? null : f.contratista,
        contacto_nombre: f.contacto_nombre, contacto_parentesco: f.contacto_parentesco, contacto_celular: '+569' + f.celular8,
        fecha_ingreso: f.fecha_ingreso, observacion: f.observacion,
      },
    });
    setOcupado(false);
    if (error) return setMsg({ t: 'error', m: errorAmigable(error.message) });
    setGuardado(data as string); setCambios(false);
    setMsg({ t: 'ok', m: `Ingreso de ${f.nombres} ${f.apellido_paterno} guardado. Ya puedes imprimir el IRL y el acuse del Reglamento Interno.` });
  }

  // Viene de "Completar ficha" (trabajador registrado en campo)
  useEffect(() => { if (rutInicial && !inicial) { setF((x) => ({ ...x, rut: formatearRut(rutInicial) })); buscarExistente(rutInicial); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [credAbierta, setCredAbierta] = useState(false);
  const [credCodigo, setCredCodigo] = useState<string | null>(null);
  const imprimir = () => guardado && window.open(`/admin/ingresos/imprimir/?id=${guardado}`, '_blank');

  return (
    <form onSubmit={guardar} className="ingreso">
      <section className="tarjeta">
        <h3 style={{ marginTop: 0 }}>1. Carnet de identidad</h3>
        {!inicial && (
          <div className="lectura-carnet">
            <label className={`btn-capturar ${leyendo ? 'ocupado' : ''}`}>
              <span className="ico"><IconoReverso /></span>
              <span>{leyendo ? `${leyendo.t} ${leyendo.p}%` : 'Fotografiar reverso del carnet'}</span>
              <input type="file" accept="image/*" capture="environment" onChange={fotoReverso} disabled={!!leyendo} hidden />
            </label>
            {leyendo && <div className="barra-prog"><div style={{ width: `${leyendo.p}%` }} /></div>}
            <div className="muted ayuda-carnet">
              Carnet horizontal, de frente, con buena luz y sin reflejos. Que se lean nítidas las 3 líneas con &lt;&lt;&lt; de abajo.
              Lee nombre completo, RUT, nacimiento, sexo, N° de documento y vencimiento. La primera vez tarda un poco más (descarga el lector).
            </div>
            <details className="solo-qr">
              <summary>Leer solo el QR (RUT y fechas, sin nombres)</summary>
              <CapturaQR etiqueta="Escanear QR del carnet" ayuda="Apunta al QR del reverso del carnet" onScan={alLeer} alto={260} />
            </details>
          </div>
        )}
        <div className="fila" style={{ marginTop: '.8rem' }}>
          <div className={ec('rut')} onBlur={tb('rut')}>
            <label>RUT *</label>
            <input value={f.rut} onChange={(e) => set('rut', e.target.value)} onBlur={() => { if (!inicial && !f.extranjero && rutValido(f.rut) && !f.nombres) buscarExistente(f.rut); }}
              placeholder="12.345.678-9" disabled={!!inicial} />
            {f.rut && !rutOk && <small className="txt-err">RUT inválido</small>}
          </div>
          <div className="campo" style={{ flex: '0 1 150px' }}>
            <label className="check" style={{ marginTop: '1.5rem' }}><input type="checkbox" checked={f.extranjero} disabled={!!inicial} onChange={(e) => set('extranjero', e.target.checked)} /> Sin RUT chileno</label>
          </div>
          <div className={ec('cedula_serie')} onBlur={tb('cedula_serie')}><label>N° documento</label><input value={f.cedula_serie} onChange={(e) => set('cedula_serie', e.target.value)} /></div>
        </div>
        <div className="fila">
          <div className={ec('nombres')} onBlur={tb('nombres')}><label>Nombres *</label><input value={f.nombres} onChange={(e) => set('nombres', e.target.value)} /></div>
          <div className={ec('apellido_paterno')} onBlur={tb('apellido_paterno')}><label>Apellido paterno *</label><input value={f.apellido_paterno} onChange={(e) => set('apellido_paterno', e.target.value)} /></div>
          <div className={ec('apellido_materno')} onBlur={tb('apellido_materno')}><label>Apellido materno</label><input value={f.apellido_materno} onChange={(e) => set('apellido_materno', e.target.value)} /></div>
        </div>
        <div className="fila">
          <div className={ec('fecha_nacimiento')} onBlur={tb('fecha_nacimiento')}><label>Fecha de nacimiento</label><input type="date" value={f.fecha_nacimiento} onChange={(e) => set('fecha_nacimiento', e.target.value)} /></div>
          <div className={ec('sexo')} onBlur={tb('sexo')} style={{ flex: '0 1 130px' }}>
            <label>Sexo</label>
            <select value={f.sexo} onChange={(e) => set('sexo', e.target.value)}><option value="">—</option><option value="M">Masculino</option><option value="F">Femenino</option></select>
          </div>
          <div className={ec('nacionalidad')} onBlur={tb('nacionalidad')} style={{ flex: '0 1 130px' }}><label>Nacionalidad</label><input value={f.nacionalidad} onChange={(e) => set('nacionalidad', e.target.value.toUpperCase())} placeholder="CHL" maxLength={3} /></div>
          <div className={ec('cedula_vencimiento')} onBlur={tb('cedula_vencimiento')}>
            <label>Vencimiento del carnet</label><input type="date" value={f.cedula_vencimiento} onChange={(e) => set('cedula_vencimiento', e.target.value)} />
            {vencido && <small className="txt-err">Carnet vencido</small>}
          </div>
          <div className={ec('fecha_ingreso')} onBlur={tb('fecha_ingreso')}><label>Fecha de ingreso *</label><input type="date" value={f.fecha_ingreso} onChange={(e) => set('fecha_ingreso', e.target.value)} required /></div>
        </div>
      </section>

      <section className="tarjeta">
        <h3 style={{ marginTop: 0 }}>2. Domicilio y contratista</h3>
        <div className="fila">
          <div className={ec('direccion')} onBlur={tb('direccion')} style={{ flexGrow: 2 }}><label>Dirección particular *</label><input value={f.direccion} onChange={(e) => set('direccion', e.target.value)} placeholder="Calle, número, villa o sector" /></div>
          <div className={ec('comuna')} onBlur={tb('comuna')}><label>Comuna</label><input value={f.comuna} onChange={(e) => set('comuna', e.target.value)} /></div>
        </div>
        <div className={ec('contratista')} onBlur={tb('contratista')}>
          <label>Contratista *</label>
          <select value={f.contratista} onChange={(e) => set('contratista', e.target.value)}>
            <option value="">Seleccionar…</option>
            <option value={PROPIO}>Propio / interno</option>
            {contratistas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
      </section>

      <section className="tarjeta">
        <h3 style={{ marginTop: 0 }}>3. Contacto de emergencia</h3>
        <div className="fila">
          <div className={ec('contacto_nombre')} onBlur={tb('contacto_nombre')}><label>Nombre del contacto *</label><input value={f.contacto_nombre} onChange={(e) => set('contacto_nombre', e.target.value)} /></div>
          <div className={ec('contacto_parentesco')} onBlur={tb('contacto_parentesco')}>
            <label>Parentesco *</label>
            <input list="parentescos" value={f.contacto_parentesco} onChange={(e) => set('contacto_parentesco', e.target.value)} placeholder="Madre, cónyuge…" />
            <datalist id="parentescos">{PARENTESCOS.map((p) => <option key={p} value={p} />)}</datalist>
          </div>
          <div className={ec('celular8')} onBlur={tb('celular8')}>
            <label>Celular de contacto *</label>
            <div className="celular">
              <span className="prefijo">+56 9</span>
              <input inputMode="numeric" maxLength={8} value={f.celular8} placeholder="12345678"
                onChange={(e) => set('celular8', e.target.value.replace(/\D/g, '').slice(0, 8))} />
            </div>
            {f.celular8 && !celOk && <small className="txt-err">Faltan {8 - f.celular8.length} dígito(s)</small>}
          </div>
        </div>
        <div className={ec('observacion')} onBlur={tb('observacion')}><label>Observación</label><input value={f.observacion} onChange={(e) => set('observacion', e.target.value)} placeholder="Opcional" /></div>
      </section>

      <div className={`progreso-ficha ${faltan ? '' : 'completo'}`}>
        {faltan ? `Faltan ${faltan} de ${Object.keys(validos).length} campos obligatorios` : '✔ Todos los campos obligatorios están listos'}
      </div>
      {msg && <div className={`alerta ${msg.t}`}>{msg.m}</div>}
      <div className="acciones ingreso-acciones">
        <button className="primario grande" disabled={ocupado}>{ocupado ? 'Guardando…' : guardado && !inicial ? 'Guardar cambios' : inicial ? 'Guardar cambios' : 'Guardar ingreso'}</button>
        <button type="button" className="grande" onClick={imprimir} disabled={!guardado || cambios} title={!guardado ? 'Guarda el ingreso primero' : cambios ? 'Guarda los cambios primero' : ''}>
          🖨️ Imprimir IRL y Reglamento Interno
        </button>
        <button type="button" className={`grande ${credCodigo ? '' : 'btn-cred'}`} onClick={() => setCredAbierta(true)} disabled={!guardado || cambios} title={!guardado ? 'Guarda el ingreso primero' : cambios ? 'Guarda los cambios primero' : ''}>
          🪪 {credCodigo ? `Credencial ${credCodigo}` : 'Asignar credencial de cosechero'}
        </button>
        <button type="button" onClick={onNuevo}>Nuevo ingreso</button>
      </div>
      {credAbierta && guardado && (
        <AsignarCredencial
          t={{ id: guardado, rut: f.extranjero ? f.rut.trim().toUpperCase() : normalizarRut(f.rut), extranjero: f.extranjero,
               nombre: `${f.nombres} ${f.apellido_paterno}`.trim(), contratista_id: f.contratista === PROPIO ? null : f.contratista || null }}
          onCerrar={() => setCredAbierta(false)} onAsignada={(c) => setCredCodigo(c || null)} />
      )}
    </form>
  );
}

// ---------------------------------------------------------------- Listado
function Listado({ contratistas, onEditar, onCompletar }: { contratistas: any[]; onEditar: (f: Ficha) => void; onCompletar: (rut: string) => void }) {
  const sinFicha = useTabla<any>('trabajadores', 'id,rut,nombres,apellido_paterno,contratista_id,estado,con_ficha', 'apellido_paterno');
  const pendientes = sinFicha.filas.filter((t) => !t.con_ficha && t.estado !== 'I');
  const { perfil } = useAuth();
  const [desde, setDesde] = useState(hoyISO().slice(0, 8) + '01');
  const [hasta, setHasta] = useState(hoyISO());
  const [fContr, setFContr] = useState('');
  const [buscar, setBuscar] = useState('');
  const [filas, setFilas] = useState<Ficha[]>([]);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState('');
  const tarj = useTabla<any>('tarjetas', 'codigo,trabajador_id', 'codigo', (q) => q.eq('estado', 'asignada').eq('tipo', 'W'));
  const credDe = useMemo(() => new Map(tarj.filas.map((x) => [x.trabajador_id, x.codigo] as [string, string])), [tarj.filas]);
  const [credPara, setCredPara] = useState<Ficha | null>(null);

  useEffect(() => {
    setCargando(true);
    cargarTabla<Ficha>('v_fichas_ingreso', '*', (q) => q.gte('fecha_ingreso', desde).lte('fecha_ingreso', hasta), 'fecha_ingreso')
      .then((l) => setFilas(l.reverse())).catch(() => setFilas([])).finally(() => setCargando(false));
  }, [desde, hasta]);

  const visibles = useMemo(() => {
    const b = buscar.toLowerCase();
    return filas.filter((f) => (!fContr || (fContr === PROPIO ? !f.contratista_id : f.contratista_id === fContr))
      && (!b || `${f.rut} ${f.nombre_completo}`.toLowerCase().includes(b)));
  }, [filas, fContr, buscar]);

  const nomContr = fContr === PROPIO ? 'Propio' : contratistas.find((c) => c.id === fContr)?.nombre;
  const titulo = `Ingreso de personal${nomContr ? ' - ' + nomContr : ''}`;
  const rango = `${fechaCorta(desde)} al ${fechaCorta(hasta)}`;

  async function exportar(tipo: 'xlsx' | 'pdf') {
    if (!visibles.length) return;
    setOcupado(tipo);
    try {
      if (tipo === 'xlsx') await excelIngresos(visibles, `${titulo} ${rango}`);
      else await pdfIngresos(visibles, { titulo, empresa: perfil?.empresa?.nombre ?? '', rango });
    } catch (e: any) { alert('No se pudo generar: ' + e.message); }
    setOcupado('');
  }

  return (
    <div>
      <div className="fila filtros">
        <div className="campo"><label>Ingreso desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="campo"><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        <div className="campo">
          <label>Contratista</label>
          <select value={fContr} onChange={(e) => setFContr(e.target.value)}>
            <option value="">Todos</option>
            <option value={PROPIO}>Propio / interno</option>
            {contratistas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div className="campo"><label>Buscar</label><input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="RUT o nombre" /></div>
      </div>
      <div className="acciones" style={{ marginBottom: '.8rem' }}>
        <button onClick={() => exportar('xlsx')} disabled={!visibles.length || !!ocupado}>{ocupado === 'xlsx' ? 'Generando…' : 'Excel'}</button>
        <button onClick={() => exportar('pdf')} disabled={!visibles.length || !!ocupado}>{ocupado === 'pdf' ? 'Generando…' : 'PDF por contratista'}</button>
        <span className="muted">{visibles.length} trabajador(es). El PDF deja una página por contratista con firmas, para la carpeta de prevención.</span>
      </div>
      {credPara && (
        <AsignarCredencial key={credPara.trabajador_id}
          t={{ id: credPara.trabajador_id, rut: credPara.rut, extranjero: credPara.extranjero, nombre: credPara.nombre_completo, contratista_id: credPara.contratista_id }}
          onCerrar={() => setCredPara(null)} onAsignada={() => tarj.recargar()} />
      )}
      {pendientes.length > 0 && (
        <details className="alerta aviso sin-ficha">
          <summary>{pendientes.length} trabajador(es) registrados en campo sin ficha de ingreso</summary>
          <ul>
            {pendientes.map((t) => (
              <li key={t.id}>
                <span>{t.nombres} {t.apellido_paterno ?? ''} · <span className="mono">{formatearRut(t.rut)}</span> · {contratistas.find((c) => c.id === t.contratista_id)?.nombre ?? 'Propio'}</span>
                <button className="chico" onClick={() => onCompletar(t.rut)}>Completar ficha</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="tabla-wrap">
        <table>
          <thead><tr><th>Ingreso</th><th>RUT</th><th>Nombre</th><th>Contratista</th><th>Credencial</th><th>Dirección</th><th>Contacto</th><th></th></tr></thead>
          <tbody>
            {cargando && <tr><td colSpan={8} className="muted">Cargando…</td></tr>}
            {!cargando && !visibles.length && <tr><td colSpan={8} className="muted">Sin ingresos en el período.</td></tr>}
            {visibles.map((f) => (
              <tr key={f.id}>
                <td>{fechaCorta(f.fecha_ingreso)}</td>
                <td className="mono">{f.extranjero ? f.rut : formatearRut(f.rut)}</td>
                <td>{f.nombre_completo}{f.cedula_vencimiento && f.cedula_vencimiento < hoyISO() && <> <span className="badge err">carnet vencido</span></>}</td>
                <td>{f.contratista}</td>
                <td className="mono">{credDe.get(f.trabajador_id) ?? <span className="muted">—</span>}</td>
                <td>{[f.direccion, f.comuna].filter(Boolean).join(', ')}</td>
                <td>{f.contacto_nombre}{f.contacto_parentesco ? ` (${f.contacto_parentesco})` : ''}<br /><span className="muted">{celularVisible(f.contacto_celular)}</span></td>
                <td className="acciones" style={{ justifyContent: 'flex-end' }}>
                  <button className="chico" onClick={() => onEditar(f)}>Editar</button>
                  <button className="chico" onClick={() => window.open(`/admin/ingresos/imprimir/?id=${f.trabajador_id}`, '_blank')}>🖨️ IRL y RIOHS</button>
                  <button className="chico" onClick={() => { setCredPara(f); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>🪪 {credDe.has(f.trabajador_id) ? 'Cambiar credencial' : 'Asociar credencial'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
