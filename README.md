# Cosecha La Cabaña

Registro de cosecha en terreno con credenciales QR, funcionando sin señal, más un panel de administración con reportes y liquidación a trato. Inspirado en el flujo de HubCrop Harvest+, reconstruido sobre **GitHub + Vercel + Supabase**.

## Partes

| Ruta | Para quién | Qué hace |
|---|---|---|
| `/campo/` | Jefes de cuadrilla (teléfono) | App instalable (PWA). Configura el día, lee credenciales con la cámara, registra entregas, asigna credenciales leyendo el carnet. Todo queda en el teléfono y se sube al haber señal. |
| `/admin/` | Administración | Resumen del día, reportes y pagos, trabajadores, tarjetas QR, maestros, reglas, tarifas y usuarios. |
| `/admin/tarjetas/` | Administración | Genera códigos internos (`BC-W-0100000001` credencial, `BC-B-0100000001` caja), registra códigos ya impresos e imprime en A4 o en impresora térmica. |

## Flujo en terreno

1. **Día**: huerto, cuartel, envase, calidad (turno y contratista si se exigen).
2. **Credencial** (una vez por trabajador): QR del carnet o RUT escrito → datos si es nuevo → leer la credencial que se le entrega.
3. **Registrar**: leer credencial → tocar la cantidad de envases (o leer el QR de cada caja, según la regla del huerto).
4. **Sincronizar**: automático cada 3 minutos y al recuperar señal.

Validaciones: credencial asignada, trabajador no bloqueado, antirebote por trabajador (segundos configurables), caja no repetida dentro de N horas (en el teléfono y en el servidor), configuración del día completa.

## Stack

- **Next.js 15** exportado como sitio estático (`output: 'export'`), servido por Vercel.
- **Supabase**: Postgres con RLS por empresa, funciones `generar_tarjetas`, `importar_tarjetas`, `asignar_credencial`, `liberar_credencial`, vista `v_entregas_detalle` con cálculo de monto por tarifa vigente.
- **Dexie (IndexedDB)** para trabajar sin señal; **html5-qrcode** para leer QR; **qrcode** para generar.

## Multiempresa

Todas las tablas llevan `empresa_id`. Cada empresa tiene un `codigo` (01, 02…) que va dentro de sus códigos QR. Para agregar una empresa: insertar en `empresas` e invitar a su primer administrador en `invitaciones`.

## Usuarios

Solo se pueden registrar correos invitados (tabla `invitaciones`, desde **Usuarios** en el panel). Al crear la cuenta, un trigger crea su perfil con la empresa y el rol: `admin`, `jefe` (terreno) o `consulta`.

## Desarrollo

```bash
cp .env.example .env.local
npm install
npm run dev
```

Migraciones en `supabase/migrations/` (ya aplicadas al proyecto `cosecha-lacabana`).
