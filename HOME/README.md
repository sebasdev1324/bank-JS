# TuBanco: simulador bancario educativo

Aplicación web de pruebas en red local. Los datos viven en una base SQLite de este equipo; el proyecto no está conectado a infraestructura bancaria ni diseñado para exponerse directamente a Internet.

## Requisitos

- Node.js 24 o posterior, con `node:sqlite` disponible.
- npm.

## Ejecutar

Desde esta carpeta (`HOME`), en PowerShell:

```powershell
npm install
npm start
```

En el equipo anfitrión abre `http://localhost:3000/`. Para ejecutar las pruebas de API y persistencia: `npm test`.

## Probar desde otro dispositivo de la misma red

1. Conecta ambos dispositivos a la misma red Wi-Fi privada.
2. En Windows, ejecuta `ipconfig` y busca la dirección IPv4 del adaptador Wi-Fi activo.
3. En el otro dispositivo abre `http://<DIRECCION-IP>:3000/`, sustituyendo el marcador por esa dirección.
4. Si Windows Firewall pregunta, permite Node.js únicamente en redes privadas. No habilites acceso en redes públicas.

El servidor escucha en las interfaces de red locales (`0.0.0.0`); puedes cambiar puerto o interfaz con `PORT` y `HOST`.
La conexión entre dispositivos usa HTTP sin cifrado: úsala solo en una red privada de confianza, nunca en una Wi-Fi pública. Para acceso público se requiere HTTPS y una revisión de seguridad independiente.

## Primera versión

- Crear una cuenta con nombre, contraseña y saldo de apertura.
- Iniciar sesión, consultar saldo e historial, y cerrar sesión.
- Hacer depósitos, retiros y transferencias entre cuentas; el historial refleja ambos lados de cada transferencia.
- Pagar agua, electricidad, gas, internet o telefonía móvil con referencia de cliente.
- Navegar por resumen, servicios, movimientos y seguridad; ocultar saldo y revisar actividad reciente desde menús.
- Revisar operación, origen, destino e importe en una confirmación antes de enviar cada transacción.
- Reintentar una solicitud de transacción con la misma clave sin duplicar el movimiento; cada clave queda asociada a una cuenta y a sus datos originales.
- Buscar movimientos por referencia, descripción o importe, filtrar abonos/cargos y abrir comprobantes privados.
- Cada movimiento tiene una referencia de consulta; solo la cuenta propietaria puede abrir su comprobante.
- Cambiar la contraseña verificando la actual; las sesiones abiertas anteriormente se revocan.
- Consultar cambios de saldo realizados desde otro dispositivo de la red local.

El saldo inicial puede ser de $0 a $1,000,000. Las contraseñas nuevas requieren al menos 12 caracteres; el servidor guarda una derivación `scrypt` y no conserva contraseñas en texto claro.

La base se crea automáticamente en `data/bank.sqlite` y se comparte entre clientes que usan este servidor. Los archivos de base de datos y `node_modules` están excluidos de Git. Para uso fuera de una red de pruebas se necesita, como mínimo, HTTPS, alojamiento seguro y una revisión de seguridad independiente.

## Beta online privada

Sí se puede conectar a testers fuera de tu Wi-Fi, pero no publiques este servidor HTTP directamente ni abras el puerto 3000 en el router. Una opción sencilla es un túnel HTTPS (por ejemplo, Cloudflare Tunnel) protegido por una política de acceso que permita solo los correos de tus testers. El túnel debe apuntar a `http://127.0.0.1:3000`; el tráfico público termina en HTTPS y el origen permanece local.

Configura estas variables en el gestor de secretos del host, nunca en el repositorio:

- `NODE_ENV=production`
- `HOST=127.0.0.1` para un túnel que corre en el mismo equipo; en contenedores se puede requerir `0.0.0.0` detrás del proxy
- `TRUST_PROXY=loopback` si el proxy corre localmente; si está en otro host, usa su IP/rango privado exacto, nunca `true`
- `REGISTRATION_CODE` con un valor aleatorio que compartirás solo con los testers

El servidor se niega a iniciar en producción sin invitación y proxy configurados, rechaza solicitudes que no lleguen marcadas como HTTPS y usa cookies `Secure`, Helmet, validación de origen y límites de intentos. El proxy debe conservar el host público y enviar `X-Forwarded-Proto: https`. El cliente web debe servirse desde el mismo origen; no habilites CORS con comodín.

Mantén la beta en una sola instancia con almacenamiento persistente para `data/bank.sqlite`. El limitador actual guarda contadores en memoria, así que al reiniciar se reinician los cupos; para varias instancias usa Redis y una base compartida. Estas medidas son una base para pruebas privadas, no sustituyen una auditoría antes de manejar datos o fondos reales.

## Beta online privada

No publiques el puerto 3000 directamente en el router ni habilites acceso desde redes públicas. Para invitar a unos pocos clientes, usa un túnel HTTPS con una política de acceso (por ejemplo, Cloudflare Tunnel más Cloudflare Access con correos permitidos) o un proxy HTTPS equivalente. El túnel debe llegar al servidor local; no hace falta abrir el puerto al exterior.

Configura las variables desde el panel de secretos del proveedor, nunca dentro del repositorio:

- `NODE_ENV=production`
- `REGISTRATION_CODE`: código aleatorio que entregarás solo a los testers
- `TRUST_PROXY=loopback` si el proxy/túnel corre en el mismo equipo; si no, limita este valor a la IP o rango exacto del proxy
- `HOST=127.0.0.1` para un túnel local; usa `0.0.0.0` solo dentro de una plataforma donde el firewall y el proxy sean los que reciben el tráfico

El servidor se niega a iniciar en producción sin `REGISTRATION_CODE` y `TRUST_PROXY`, rechaza HTTP, comprueba el origen de las solicitudes, activa cabeceras Helmet, limita intentos de login/registro/operaciones y marca las cookies como `Secure`. Revisa en el proxy que envíe `X-Forwarded-Proto: https` y la IP del cliente correctamente.

Usa una sola instancia con un volumen persistente para `data/bank.sqlite`; SQLite y el limitador actual en memoria no están preparados para varias réplicas. Si escalas a varias instancias, migra a una base compartida y a un almacén de rate-limit como Redis. Rota el código de invitación al terminar la beta.