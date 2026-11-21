'use client';
import { fechaCL as fechaISO, hoyISO, horaCorta } from '@/lib/util';

const fechaCL = (iso: string) => fechaISO(hoyISO(new Date(iso)));

/** Primer paso de la jornada: descargar los datos con señal para trabajar el resto del día sin conexión */
export default function InicioDia({ online, ultimaDescarga, pendientes, sincronizando, paso, error, onDescargar, onContinuar }: {
  online: boolean; ultimaDescarga: string | null; pendientes: number; sincronizando: boolean; paso: string; error: string;
  onDescargar: () => void; onContinuar: () => void;
}) {
  return (
    <div className="tarjeta inicio-dia">
      <h2 style={{ marginTop: 0 }}>Iniciar el día</h2>
      <p style={{ marginTop: 0 }}>
        Antes de cosechar, descarga los datos del día con señal: trabajadores y credenciales registrados en la nube,
        contratistas, huertos y cuarteles activos. Después la app funciona sin conexión.
      </p>
      {pendientes > 0 && <div className="alerta info">Hay {pendientes} registro(s) de antes en el teléfono: se suben primero.</div>}
      {!online && <div className="alerta aviso">Sin señal. Busca un lugar con cobertura o conéctate a wifi.</div>}
      <button className="primario grande" onClick={onDescargar} disabled={!online || sincronizando}>
        {sincronizando ? 'Descargando…' : '⬇ Descargar datos del día'}
      </button>
      {sincronizando && paso && <div className="alerta info" style={{ marginTop: '.6rem' }}>{paso}</div>}
      {error && <div className="alerta error" style={{ marginTop: '.6rem' }}>{error}</div>}

      {ultimaDescarga && !sincronizando && (
        <button className="grande" style={{ marginTop: '.8rem' }} onClick={() => {
          if (confirm(`Vas a trabajar con los datos descargados el ${fechaCL(ultimaDescarga)} a las ${horaCorta(ultimaDescarga)}. Los trabajadores o cambios nuevos de la nube no estarán. ¿Continuar?`)) onContinuar();
        }}>
          Continuar con datos del {fechaCL(ultimaDescarga)}
        </button>
      )}
    </div>
  );
}
