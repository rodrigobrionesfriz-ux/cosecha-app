# Respaldo de QSecha en Firebase

Cada noche una tarea de GitHub (`.github/workflows/respaldo.yml`) copia la base de Supabase
y la sube a Firebase Storage, en `respaldos/AAAA-MM-DD_HHMM/`:

| Archivo | Contenido |
|---|---|
| `qsecha_<fecha>.dump` | Toda la app: tablas, datos, vistas, funciones, triggers y políticas |
| `auth_usuarios_<fecha>.sql.gz` | Usuarios de acceso (correos, equipos) para que los perfiles calcen |
| `conteo_<fecha>.csv` | Filas por tabla, para revisar rápido |

Se guardan 60 días. Las fotos de calidad del acopio (bucket `acopio-fotos` de Supabase) no van en este respaldo.

## Configuración (una sola vez)

1. **Proyecto Firebase**: en https://console.firebase.google.com crea un proyecto (ej. `qsecha-respaldo`).
   Storage requiere el plan **Blaze** (pago por uso, con tarjeta); para unos pocos MB al día el costo es prácticamente cero.
   En *Storage* > *Comenzar*, elige ubicación `southamerica-west1` (Santiago) o una de EE.UU. Anota el nombre del bucket
   (algo como `qsecha-respaldo.firebasestorage.app`).
2. **Cuenta de servicio**: en Google Cloud Console del mismo proyecto > *IAM* > *Cuentas de servicio* > crear `respaldo-qsecha`
   con el rol **Administrador de almacenamiento (Storage Admin)**. En *Claves* > *Agregar clave* > JSON. Se descarga un archivo.
3. **Cadena de conexión de Supabase**: Supabase > proyecto `cosecha-lacabana` > *Connect* > **Session pooler** (funciona por IPv4).
   Copia la URI y reemplaza `[YOUR-PASSWORD]` por la clave de la base (si no la tienes, *Database settings* > *Reset password*).
4. **Secretos en GitHub**: repositorio `cosecha-app` > *Settings* > *Secrets and variables* > *Actions* > *New repository secret*:
   - `SUPABASE_DB_URL`: la URI del paso 3
   - `FIREBASE_SA_KEY`: todo el contenido del JSON del paso 2
   - `FIREBASE_BUCKET`: el nombre del bucket del paso 1 (sin `gs://`)
5. **Probar**: GitHub > *Actions* > *Respaldo base de datos* > *Run workflow*. En 2 o 3 minutos debe quedar en verde
   y en Firebase Storage aparece la carpeta `respaldos/`.

Si un respaldo falla, GitHub envía un correo al dueño del repositorio.

## Restaurar

En un computador con PostgreSQL 17 (`psql`, `pg_restore`), descarga desde Firebase Storage la carpeta de la fecha elegida.

**A un proyecto Supabase nuevo** (si el original se perdiera):
```bash
NUEVA="postgresql://postgres.xxxx:CLAVE@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"
gunzip -c auth_usuarios_<fecha>.sql.gz | psql "$NUEVA"          # usuarios primero
pg_restore --no-owner --no-privileges -d "$NUEVA" qsecha_<fecha>.dump
```
Luego cambia en Vercel las variables `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` y vuelve a desplegar
la Edge Function `registrar-equipo`.

**Recuperar solo una tabla** (ej. entregas borradas por error) sin tocar lo demás: restaura el `.dump` en una base de
prueba y copia de ahí las filas necesarias.
