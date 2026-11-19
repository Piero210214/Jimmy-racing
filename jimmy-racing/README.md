# JIMMY RACING — modo online

Juego de carreras 3D (motor WebGL2 propio) con multijugador online para hasta **5 pilotos humanos por sala**.
El servidor es **Node.js puro (HTTP + WebSocket RFC 6455 implementado en `server/ws.js`)**: no hay dependencias, no hace falta `npm install`.

> Nota: se pidió Express + Socket.IO, pero en el entorno de desarrollo no se podían instalar paquetes ni probarlos, así que se acordó usar Node + WebSocket nativo sin dependencias.

## 1. Instalar Node.js
Necesitas Node.js **18 o superior** (recomendado 22 LTS): https://nodejs.org → descarga "LTS" e instala. Comprueba con `node -v`.
(Los tests de integración usan el `WebSocket` nativo de Node 22.)

## 2. Ejecutar en local
```bash
cd jimmy-racing
node server/server.js          # o: npm start
```
Abre **http://localhost:3000** en el navegador. Para probar con dos jugadores en el mismo ordenador abre dos ventanas (mejor una normal y otra de incógnito).
Otro puerto: `PORT=8080 node server/server.js` (Windows PowerShell: `$env:PORT=8080; node server/server.js`).
Desde otro dispositivo de tu red: `http://IP-DE-TU-PC:3000`.

El juego individual también funciona abriendo `dist/jimmy-racing.html` directamente (sin servidor); el botón ONLINE solo funciona cuando el juego se abre desde el servidor.

Si cambias el código de `src/`: `node tools/build.js` regenera `dist/jimmy-racing.html`.

## 3. Cómo crear y compartir una sala (máx. 5 jugadores)
1. Menú principal → **Online** → escribe tu nombre → **Crear sala**. Entras al lobby; arriba aparece el **código de 5 letras** (p. ej. `K7M2Q`, único por sala). Compártelo.
2. Tus amigos: **Online → Código de sala → Entrar** (el servidor valida el código; si no existe o la sala está llena avisa).
3. En el lobby se ve cada jugador con su coche, conexión/ping y estado **LISTO / NO LISTO**. Los invitados pulsan **Listo** (pueden cancelarlo).
4. El **anfitrión** elige circuito (1-10, mismos escenarios que la campaña), máximo de jugadores (2-5), vueltas, hora, clima, visibilidad y, opcionalmente, rivales IA (por defecto **ninguno**; si se activan se marcan como BOT). Puede **Expulsar** jugadores y **Cerrar sala**.
5. **Iniciar carrera** (solo anfitrión) se habilita cuando hay ≥2 jugadores conectados y todos los invitados están listos; si alguien se desmarca o se desconecta se vuelve a bloquear. Semáforo de salida sincronizado.
6. Si el anfitrión sale, el control pasa automáticamente a otro jugador conectado. Si un invitado se desconecta en carrera puede volver con su token (reconexión).

## 3b. Campaña (un jugador)
Menú → **Campaña · 10 niveles**. Cada nivel tiene circuito y escenario propios, 3 objetivos (1 estrella cada uno), regla de desbloqueo (completar el anterior = terminar en la posición exigida) y recompensa (puntos + siguiente nivel). El progreso se guarda en el navegador (`localStorage`, clave `jr_levels_v1`). Hay exactamente 10 niveles.

## 3c. Choques
Impactos ≥6 m/s producen fragmentos; ≥12 trozos de parachoques/retrovisor/barandilla; ≥20 m/s (≈72 km/h perpendiculares) "choque fuerte": el piloto sale despedido (animación sin sangre), el coche se detiene exactamente 3,0 s y la carrera continúa. Los restos se borran solos a los 10 s.

## Pruebas
`npm test` (Node, sin navegador): ws, vehículo, carrera, obstáculos, objetos, túnel, niveles, choques, online y salas. Pruebas de navegador (Playwright, opcionales): `tests/browser_single.js`, `browser_campaign.js`, `browser_levels.js`, `browser_crash.js`, `browser_online.js`.

## 4. Cómo funciona (arquitectura)
- **Servidor autoritativo**: el servidor ejecuta la física de **todos** los coches (`src/core/*`, el mismo código del modo individual a 120 Hz). Los clientes **solo envían sus controles** (acelerador, freno, volante, freno de mano, ~30/s). Nadie puede fijar su posición, velocidad ni resultado.
- El servidor calcula vueltas, checkpoints, posiciones, tiempos, colisiones y resultados, y emite **snapshots a 24 Hz**. El cliente interpola los coches rivales (retardo 120 ms) y extrapola ligeramente el propio.
- Validación: tipos y rangos de todos los mensajes, controles limitados a su rango, paquetes antiguos descartados, límite de tamaño (2 KB), límite de frecuencia por conexión (120 msg/s), máx. 16 conexiones por IP, 200 salas, 5 jugadores por sala, nombres saneados, comprobación de `Origin`, ping/pong de vida, entrada solo con código válido (las salas privadas no aparecen en la lista).
- No se guardan contraseñas ni datos personales: solo un nombre de piloto en memoria y un token de sesión aleatorio (sessionStorage) para reconectar.

## 5. Pruebas incluidas
```bash
node tests/ws.test.js          # conformidad RFC 6455 y abuso del protocolo (17 comprobaciones)
node tests/net.test.js         # servidor real + 2 clientes WebSocket: sala, listos, carrera completa, desconexión, reconexión, resultados
node tests/net5.test.js        # reglas de sala: máx. 5, códigos, listo/iniciar, expulsar, cerrar, traspaso de anfitrión
NODE_PATH=<ruta a playwright> node tests/browser_online.js   # 2 navegadores reales jugando entre sí (necesita Playwright)
node tests/vehicle.test.js && node tests/race.test.js         # física y carrera individual con IA
```

## 6. Desplegar en Internet (necesita Node y WebSockets persistentes)
El servidor guarda las carreras en memoria: usa **una sola instancia** y que no se apague sola.
Siempre se sirve por `https://`; el cliente usa `wss://` automáticamente.

### Render (web service)
1. Sube la carpeta a un repositorio de GitHub.
2. Render → *New → Web Service* → elige el repo. (Con `render.yaml` se configura solo; si lo haces a mano: *Runtime* Node, *Build Command* `node tools/build.js`, *Start Command* `node server/server.js`, *Health Check Path* `/healthz`.)
3. Render asigna el puerto con `PORT` (el servidor ya lo usa). Abre la URL `https://jimmy-racing.onrender.com`.
   - El plan gratuito se duerme tras ~15 min sin tráfico (la primera visita tarda ~1 min y se pierden las salas). Para partidas fiables usa un plan de pago.

### Railway
1. *New Project → Deploy from GitHub repo*. Railway detecta `package.json` y ejecuta `npm start`.
2. *Settings → Networking → Generate Domain*. Listo (WebSockets soportados).

### Fly.io
```bash
fly auth login
fly launch --no-deploy        # acepta el Dockerfile y fly.toml existentes; cambia el nombre de la app
fly deploy
fly open
```
`fly.toml` mantiene 1 máquina siempre encendida (`auto_stop_machines = "off"`).

### Otras variables de entorno
- `PORT` (por defecto 3000), `NODE_ENV=production`.
- `ALLOWED_ORIGINS=https://mi-dominio.com` — orígenes adicionales permitidos si sirves el HTML desde otro dominio (por defecto solo se acepta el mismo host).

## 7. Límites conocidos de esta primera versión
- **Sin predicción en cliente**: tu coche se muestra con el estado del servidor (extrapolado ~1 snapshot). En red local no se nota; con 100+ ms de ping notarás algo de retardo en el volante.
- Sin chat, sin ranking persistente, sin podio 3D online (hay pantalla de resultados).
- Las salas viven en la memoria del servidor: si se reinicia, se pierden.
- Pendiente de comprobar por el propietario: partida real a través de Internet (ver estado en la entrega).
