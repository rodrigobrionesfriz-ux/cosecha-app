'use client';
import { useEffect, useState } from 'react';
import { cargarTabla } from '@/lib/datos';
import { formatearRut } from '@/lib/util';
import { celularVisible, fechaCorta, Ficha } from '@/lib/ingresos';

/**
 * Planilla por trabajador para la carpeta de prevención de riesgos.
 * Pendiente: reemplazar el cuerpo por la plantilla oficial "Derecho a Saber" de la empresa.
 */
export default function ImprimirIngreso() {
  const [f, setF] = useState<Ficha | null>(null);
  const [emp, setEmp] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('id');
    if (!id) { setError('Falta el trabajador.'); return; }
    (async () => {
      try {
        const [fi] = await cargarTabla<Ficha>('v_fichas_ingreso', '*', (q) => q.eq('trabajador_id', id));
        if (!fi) { setError('Este trabajador no tiene ficha de ingreso.'); return; }
        const [e] = await cargarTabla<any>('empresas', 'nombre,rut', (q) => q.eq('id', (fi as any).empresa_id));
        setF(fi); setEmp(e);
      } catch (e: any) { setError(e.message); }
    })();
  }, []);

  if (error) return <div className="alerta error">{error}</div>;
  if (!f) return <p className="muted">Cargando…</p>;

  const rut = f.extranjero ? f.rut : formatearRut(f.rut);
  const Dato = ({ l, v }: { l: string; v: string | null | undefined }) => (
    <div className="pl-dato"><span className="pl-l">{l}</span><span className="pl-v">{v || ' '}</span></div>
  );

  return (
    <div className="planilla-wrap">
      <div className="no-print acciones" style={{ marginBottom: '1rem' }}>
        <button className="primario" onClick={() => window.print()}>🖨️ Imprimir</button>
        <button onClick={() => window.close()}>Cerrar</button>
      </div>
      <div className="alerta aviso no-print">Formato provisorio: cuando se cargue la planilla oficial Derecho a Saber, se imprimirá con ese formato y estos mismos datos.</div>

      <article className="planilla">
        <header className="pl-cab">
          <div>
            <div className="pl-emp">{emp?.nombre ?? ''}</div>
            {emp?.rut && <div className="pl-sub">RUT {formatearRut(emp.rut)}</div>}
          </div>
          <div className="pl-titulo">DERECHO A SABER<br /><small>Obligación de informar los riesgos laborales (DS 44)</small></div>
        </header>

        <h4>Identificación del trabajador</h4>
        <div className="pl-grilla">
          <Dato l="Nombre completo" v={f.nombre_completo} />
          <Dato l="RUT" v={rut} />
          <Dato l="Fecha de nacimiento" v={fechaCorta(f.fecha_nacimiento)} />
          <Dato l="Sexo" v={f.sexo === 'M' ? 'Masculino' : f.sexo === 'F' ? 'Femenino' : ''} />
          <Dato l="Nacionalidad" v={f.nacionalidad === 'CHL' ? 'Chilena' : f.nacionalidad} />
          <Dato l="N° documento" v={f.cedula_serie} />
          <Dato l="Dirección particular" v={[f.direccion, f.comuna].filter(Boolean).join(', ')} />
          <Dato l="Fecha de ingreso" v={fechaCorta(f.fecha_ingreso)} />
          <Dato l="Empleador / contratista" v={f.contratista === 'Propio' ? (emp?.nombre ?? 'Propio') : f.contratista} />
          <Dato l="RUT contratista" v={f.contratista_rut ? formatearRut(f.contratista_rut) : ''} />
          <Dato l="Cargo / labor" v="Cosechero(a)" />
        </div>

        <h4>Contacto en caso de emergencia</h4>
        <div className="pl-grilla">
          <Dato l="Nombre" v={f.contacto_nombre} />
          <Dato l="Parentesco" v={f.contacto_parentesco} />
          <Dato l="Celular" v={celularVisible(f.contacto_celular)} />
        </div>

        <h4>Declaración</h4>
        <p className="pl-texto">
          Declaro haber sido informado(a) de los riesgos que entrañan mis labores, de las medidas preventivas y de los métodos de
          trabajo correctos, según lo establecido en el DS 44 sobre Gestión Preventiva de los Riesgos Laborales.
        </p>

        <div className="pl-firmas">
          <div><span />Firma del trabajador(a)</div>
          <div><span />Firma de quien informa</div>
        </div>
        <div className="pl-pie">Fecha: ____ / ____ / ________ · Registrado por {f.registrado_por_nombre ?? ''}</div>
      </article>
    </div>
  );
}
