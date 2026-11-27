import { formatearRut } from '@/lib/util';
import { Ficha } from '@/lib/ingresos';
import { Empresa, logoUrl, rutEmpresa } from '@/lib/empresa';

/**
 * IRL (Información de Riesgos Laborales, Art. 15 D.S. 44) y acuse de recibo del
 * Reglamento Interno de Orden, Higiene y Seguridad. Una hoja carta por documento.
 * Nombres, RUT, logo, encargado de prevención y datos del documento vienen de la
 * empresa configurada (Configuración → Empresa).
 */
function datosEmpresa(e?: Empresa | null) {
  const razon = (e?.nombre || '').toUpperCase();
  const rut = rutEmpresa(e);
  const irl = (e?.irl_razon_social || razon).toUpperCase();
  return {
    irl, riohs: (e?.riohs_razon_social || razon).toUpperCase(), rut, logo: logoUrl(e),
    encargado: { cargo: e?.prev_cargo || 'FIRMA ENCARGADO DE SEGURIDAD Y SALUD EN EL TRABAJO', nombre: (e?.prev_nombre || '').toUpperCase(), registro: e?.prev_registro || '' },
    doc: { codigo: e?.irl_codigo || 'IRL', version: e?.irl_version || '1.0', aprobacion: e?.irl_aprobacion || '' },
    pie: `PREVENCION DE RIESGOS – ${irl}${rut ? ' / ' + rut : ''}`,
  };
}

export type Tipo = 'nuevo' | 'transferido' | 'ausencia';

/** Las dos hojas carta (IRL y acuse del Reglamento) con los datos del trabajador */
export function HojasIRL({ f, tipo, cargo, llenarRiohs, empresa }: { f: Ficha; tipo: Tipo; cargo: string; llenarRiohs: boolean; empresa?: Empresa | null }) {
  const E = datosEmpresa(empresa);
  const nombre = f.nombre_completo.toUpperCase();
  const rut = f.extranjero ? f.rut : formatearRut(f.rut);
  const [a, m, d] = (f.fecha_ingreso || '').split('-');
  const marca = (t: Tipo) => (tipo === t ? 'x' : '');
  return (
    <>
      {/* ---------------- Hoja 1: IRL ---------------- */}
      <article className="irl-hoja">
        <table className="irl-cab">
          <colgroup><col style={{ width: '23%' }} /><col style={{ width: '50%' }} /><col style={{ width: '27%' }} /></colgroup>
          <tbody>
            <tr>
              <td rowSpan={3} className="c">{E.logo ? <img src={E.logo} alt="" className="irl-logo" /> : <b style={{ fontSize: '9pt' }}>{E.irl}</b>}</td>
              <td rowSpan={3} className="c irl-titulo">IRL Información de Riesgos Laborales<br />Art. 15 del D.S. 44</td>
              <td className="irl-meta">Código: {E.doc.codigo}</td>
            </tr>
            <tr><td className="irl-meta">Versión: {E.doc.version}</td></tr>
            <tr><td className="irl-meta">Fecha aprobación: {E.doc.aprobacion}</td></tr>
            <tr><td className="c">IRL: CARGO</td><td className="c">{E.irl}</td><td className="c">{E.rut}</td></tr>
          </tbody>
        </table>

        <div className="irl-barra">TRABAJADOR AGRICOLA – COSECHA</div>
        <div className="irl-barra chica">RECEPCION Y CAPACITACION DE LA IRL</div>

        <p>Datos de la persona trabajadora y confirmación de la entrega del documento.</p>
        <p>Los riesgos a informar a las personas trabajadoras tienen directa relación con su puesto de trabajo considerando lo siguiente:</p>
        <ul className="irl-lista">
          <li>Los riesgos que entrañan sus labores (generales del centro de trabajo o área y los específicos del puesto de trabajo), las medidas de prevención que deben considerar y los métodos de trabajo correcto que estos deben aplicar.</li>
          <li>Las características de elementos, productos y sustancias que utilicen en los procesos de producción o en su trabajo, la identificación de los mismos (nombre, fórmula, sinónimos, aspecto y olor), los límites de exposición permisibles para esos productos, los peligros que estos encierran para su salud y las medidas de control y de prevención que deben adoptar para evitar tales riesgos.</li>
          <li>Los riesgos que se puedan derivar ante situaciones de emergencias, catástrofes o desastres y las medidas de prevención y respuesta.</li>
        </ul>

        <table className="irl-datos">
          <colgroup><col style={{ width: '25%' }} /><col style={{ width: '5%' }} /><col style={{ width: '26%' }} /><col style={{ width: '5%' }} /><col style={{ width: '29%' }} /><col style={{ width: '10%' }} /></colgroup>
          <tbody>
            <tr className="verde"><td colSpan={4}>Nombre del trabajador</td><td colSpan={2}>RUT</td></tr>
            <tr className="alto"><td colSpan={4} className="dato">{nombre}</td><td colSpan={2} className="dato">{rut}</td></tr>
            <tr className="verde"><td colSpan={6}>Cargo:</td></tr>
            <tr className="verde alto"><td colSpan={6} className="dato">{cargo.toUpperCase()}</td></tr>
            <tr>
              <td>Trabajador nuevo</td><td className="c dato">{marca('nuevo')}</td>
              <td>Trabajador transferido</td><td className="c dato">{marca('transferido')}</td>
              <td>Ausencia prolongada</td><td className="c dato">{marca('ausencia')}</td>
            </tr>
            <tr>
              <td colSpan={6} className="irl-firmas">
                <div className="irl-firma-trab"><span className="linea" />FIRMA</div>
                <div className="irl-firma-enc">
                  <b>{E.encargado.cargo}</b>
                  <b className="sep">{E.encargado.nombre}</b>
                  <b>{E.encargado.registro}</b>
                </div>
              </td>
            </tr>
            <tr className="verde"><td colSpan={6} style={{ height: '5mm' }} /></tr>
          </tbody>
        </table>
        <footer className="irl-pie"><span>{E.pie}</span><span className="pag">1</span></footer>
      </article>

      {/* ---------------- Hoja 2: Reglamento Interno ---------------- */}
      <article className="irl-hoja riohs">
        <div className="riohs-emp">{E.riohs}</div>
        <div className="riohs-sub">Reglamento de Orden, Higiene y Seguridad.</div>
        <div className="riohs-barra" />
        <h2>CONTROL DE ENTREGA, TOMA DE CONOCIMIENTO Y ACUSO DE RECIBO DEL REGLAMENTO INTERNO DE ORDEN, HIGIENE Y SEGURIDAD</h2>
        <p>Se deja expresa constancia, de acuerdo a lo establecido en el artículo 156 del Código del Trabajo y D.S 44 de la Ley 16.744 que, he recibido en forma gratuita un ejemplar del Reglamento Interno de Orden, Higiene y Seguridad de <b>{E.riohs} {E.rut}.</b></p>
        <p>Declaro bajo mi firma haber recibido, leído y comprendido el presente Reglamento Interno de Orden, Higiene y Seguridad, del cual doy fe de conocer el contenido de éste y me hago responsable de su estricto cumplimiento en cada uno de sus artículos, no pudiendo alegar desconocimiento de su texto a contar de esta fecha.</p>

        <div className="riohs-campo" style={{ marginTop: '28mm' }}>NOMBRE DEL TRABAJADOR: <span className="riohs-linea larga">{llenarRiohs ? nombre : ''}</span></div>
        <div className="riohs-campo" style={{ marginTop: '16mm' }}>
          RUT: <span className="riohs-linea media">{llenarRiohs ? rut : ''}</span>
          <span style={{ marginLeft: '8mm' }}>FECHA:&nbsp;</span>
          {llenarRiohs && d ? <span className="riohs-linea corta">{d}/{m}/{a}</span> : <span>_____/______/_______/</span>}
        </div>
        <div className="riohs-campo riohs-firma" style={{ marginTop: '22mm' }}>
          <span>FIRMA: <span className="riohs-linea media" /></span>
          <span style={{ marginLeft: '5mm' }}>HUELLA:</span>
          <span className="riohs-huella" />
        </div>
        <p className="c" style={{ marginTop: '28mm' }}>(El trabajador debe escribir de su puño y letra).</p>
        <p className="c">Este comprobante se archivará en la Carpeta personal del trabajador.</p>
        <footer className="irl-pie"><span>{E.pie}</span><span className="pag">2</span></footer>
      </article>
    </>
  );
}

export const CSS = `
.irl-wrap { max-width: 860px; }
.irl-controles { margin-bottom: 1rem; }
.irl-hojas { width: 100%; }
.irl-hoja { position: relative; box-sizing: border-box; width: 216mm; height: 279mm; padding: 15mm 19mm 16mm; margin: 0 auto 1rem;
  background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; font-size: 10pt; line-height: 1.3;
  box-shadow: 0 2px 12px rgba(0,0,0,.18); overflow: hidden; }
.irl-hoja p { margin: 0 0 3.2mm; text-align: justify; }
.irl-hoja .c { text-align: center; }
.irl-hoja table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.irl-hoja td { border: .6pt solid #000; padding: .8mm 2mm; vertical-align: middle; }
.irl-cab td { font-size: 9pt; }
.irl-logo { height: 17mm; display: block; margin: 0 auto; }
.irl-cab td.irl-titulo { font-weight: bold; font-size: 13pt; line-height: 1.25; }
.irl-cab td.irl-meta { font-size: 7.8pt; padding: .4mm 1.5mm !important; }
.irl-barra { background: #D6E3BC; border: .6pt solid #000; text-align: center; font-size: 9.6pt; padding: 1.2mm; margin-top: 4mm; }
.irl-barra.chica { margin: 2.5mm 1.5mm 4mm; padding: .5mm; font-size: 9pt; }
.irl-lista { margin: 0 0 5mm; padding-left: 9mm; }
.irl-lista li { text-align: justify; margin-bottom: 4mm; }
.irl-lista li::marker { color: #2BB24C; }
.irl-datos tr.verde td { background: #EAF1DD; }
.irl-datos tr.alto td { height: 11mm; }
.irl-datos td.dato { font-weight: bold; font-size: 10.5pt; }
.irl-firmas { height: 52mm; position: relative; }
.irl-firma-trab { position: absolute; left: 10mm; bottom: 6mm; width: 30mm; text-align: center; }
.irl-firma-trab .linea { display: block; border-top: .6pt solid #000; margin-bottom: 4mm; }
.irl-firma-enc { position: absolute; right: 9mm; top: 7mm; width: 91mm; height: 40mm; border: .8pt solid #000;
  display: flex; flex-direction: column; align-items: center; padding-top: 3mm; font-size: 7.3pt; text-align: center; }
.irl-firma-enc .sep { margin-top: 3.5mm; }
.irl-pie { position: absolute; left: 19mm; right: 19mm; bottom: 8mm; display: flex; justify-content: center; font-size: 7.8pt; }
.irl-pie .pag { position: absolute; right: 0; font-family: 'Times New Roman', serif; font-size: 10pt; }
.riohs { font-size: 10.5pt; }
.riohs-emp { font-family: Verdana, Arial, sans-serif; font-weight: bold; font-size: 9pt; letter-spacing: .02em; margin-top: 2mm; }
.riohs-sub { font-family: Verdana, Arial, sans-serif; font-weight: bold; font-size: 8.6pt; margin-top: 3mm; }
.riohs-barra { height: 4mm; background: #99CC00; margin: 2mm 0 7mm; }
.riohs h2 { font-size: 10.5pt; font-weight: bold; text-align: center; line-height: 1.6; margin: 0 0 4mm; }
.riohs-campo { font-size: 10.5pt; display: flex; align-items: flex-end; flex-wrap: nowrap; }
.riohs-linea { display: inline-block; border-bottom: .6pt solid #000; padding: 0 2mm .3mm; font-weight: bold; min-height: 4.2mm; }
.riohs-linea.larga { width: 90mm; margin-left: 1mm; }
.riohs-linea.media { width: 60mm; margin-left: 1mm; }
.riohs-linea.corta { width: 34mm; text-align: center; }
.riohs-firma { align-items: flex-start; }
.riohs-huella { display: inline-block; width: 31mm; height: 40mm; border: 2.4pt solid #000; margin-left: 15mm; margin-top: -2mm; }
@media print {
  @page { size: letter; margin: 0; }
  html, body { background: #fff !important; }
  .admin > nav, .admin-movil, .admin header { display: none !important; }
  .admin main, .admin { padding: 0 !important; margin: 0 !important; display: block !important; max-width: none !important; }
  .irl-wrap { max-width: none; }
  .irl-hojas > div { zoom: 1 !important; }
  .irl-hoja { margin: 0; box-shadow: none; page-break-after: always; break-after: page; }
  .irl-hoja:last-child { page-break-after: auto; break-after: auto; }
}
`;
