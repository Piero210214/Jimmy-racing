/* JIMMY RACING - ui.js : HUD (2D canvas) + menu screens (DOM). Every control here is wired to a real setting or action. */
(function () {
  var G = (typeof globalThis !== 'undefined' ? globalThis : window);
  G.JR = G.JR || {};
  var JR = G.JR;
  var U = JR.util, clamp = U.clamp, fmtTime = U.fmtTime;

  function hex(c) { return '#' + ('000000' + (c >>> 0).toString(16)).slice(-6); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function t2(t) { if (t == null || !isFinite(t)) return '--:--.---'; var m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3); }
  function gapTxt(g) { if (g == null) return ''; return (g >= 0 ? '+' : '-') + Math.abs(g).toFixed(1) + 's'; }

  var PAINTS = [0xc8102e, 0x1b6dff, 0xf5a300, 0x22a85a, 0x7b3ff2, 0xf2f2f2, 0x111214, 0xff5a1f];
  var PAINT_NAMES = ['Rojo', 'Azul', 'Ámbar', 'Verde', 'Violeta', 'Blanco', 'Negro', 'Naranja'];
  var NAMES = ['R. Vance', 'K. Mori', 'L. Duarte', 'T. Okafor', 'S. Brandt', 'A. Novak', 'J. Castillo', 'M. Ferreira'];

  function UI(game) {
    this.g = game; this.root = document.getElementById('ui'); this.hud = document.getElementById('hud'); this.hctx = this.hud.getContext('2d');
    this.screen = null; this.msgs = []; this.cpDelta = null; this.mini = null; this.dpr = 1; this.showHud = false; this.fadeT = 0; this.flash = 0; this.goT = 0;
    var self = this;
    this.root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act]'); if (!t) return;
      self.g.audio.click(t.getAttribute('data-act') === 'back' ? 'back' : 'ok');
      self.g.onAction(t.getAttribute('data-act'), t.getAttribute('data-val'), t);
    });
    this.root.addEventListener('input', function (e) {
      var t = e.target; if (t.getAttribute && t.getAttribute('data-set')) self.g.onSetting(t.getAttribute('data-set'), t.type === 'checkbox' ? t.checked : (t.type === 'range' ? +t.value : t.value), t);
    });
    this.root.addEventListener('change', function (e) {
      var t = e.target; if (t.getAttribute && t.getAttribute('data-set') && t.tagName === 'SELECT') { self.g.audio.click('ok'); }
    });
  }
  UI.PAINTS = PAINTS; UI.NAMES = NAMES;

  /* ------------------------------------------------------------------ screens */
  function sel(id, opts, cur) {
    return '<select data-set="' + id + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>';
  }
  function row(label, ctl) { return '<div class="row"><label>' + label + '</label><div class="ctl">' + ctl + '</div></div>'; }
  function bar(v) { return '<span class="bar"><i style="width:' + Math.round(clamp(v, 0, 1) * 100) + '%"></i></span>'; }
  function statsOf(spec) {
    var power = spec.torquePeak * spec.rpmPeak / 9549 / 1000;                      // kW approx -> 0..1 by 440 kW
    return { pot: clamp(power / 0.45, 0, 1) * 1, peso: clamp(1 - (spec.mass - 1100) / 800, 0, 1), agarre: clamp((spec.tyreMu - 0.9) / 0.5, 0, 1), aero: clamp(spec.clA / 1.5, 0.05, 1), vmax: clamp((spec.gears[5] ? 0.55 : 0.5) + spec.rpmRedline / 20000 + spec.clA * 0.0, 0, 1) };
  }

  UI.prototype.show = function (name, data) {
    this.screen = name; var g = this.g, s = g.settings, h = '';
    var CARS = JR.vehicle.CARS;
    switch (name) {
      case 'loading': h = '<div class="center"><div class="logo small">JIMMY RACING</div><div class="load"><i id="loadbar"></i></div><p id="loadtxt">' + esc(data || 'Cargando…') + '</p></div>'; break;
      case 'main':
        h = '<div class="panel left"><div class="logo">JIMMY<b>RACING</b></div><p class="tag">Simulación de carreras · Jimmy Ring 4,9 km</p>' +
          '<button data-act="campaign" class="big">Campaña · 10 niveles</button><button data-act="setup" data-val="race" class="big">Carrera</button><button data-act="setup" data-val="tt" class="big">Contrarreloj</button><button data-act="o_open" class="big">Online</button>' +
          '<button data-act="settings" class="big">Ajustes</button><button data-act="controls" class="big">Controles</button>' +
          '<p class="hint">Mejor vuelta guardada: <b>' + (g.best ? t2(g.best) : '—') + '</b></p></div>'; break;
      case 'campaign': {
        var LV = JR.levels, pr = data.prog, cur = LV.LEVELS.filter(function (l) { return LV.isUnlocked(pr, l.id); }).length;
        h = '<div class="panel left wide camp"><h2>Campaña</h2><p class="hint">Nivel ' + cur + ' de ' + LV.COUNT + ' desbloqueado · ' + LV.totalStars(pr) + '/' + (LV.COUNT * 3) + ' estrellas · ' + LV.points(pr) + ' pts · Coche: <b>' + CARS[s.carId].name + '</b> <button data-act="setup" data-val="race">Cambiar coche</button></p><div class="lvls">' +
          LV.LEVELS.map(function (l) {
            var open = LV.isUnlocked(pr, l.id), st = pr.stars[l.id] || 0;
            return '<div class="lvl' + (open ? '' : ' lock') + (pr.done[l.id] ? ' done' : '') + '"><div class="lh"><b>' + l.id + '. ' + esc(l.name) + '</b><span class="stars">' + [0, 1, 2].map(function (i) { return i < st ? '★' : '☆'; }).join('') + '</span></div>' +
              '<small>' + esc(LV.SCENES[l.scene].name) + ' · ' + l.laps + ' vueltas · IA ' + ({ easy: 'fácil', normal: 'normal', hard: 'difícil', pro: 'pro' })[l.diff] + '</small>' +
              (open ? '<ul>' + l.objectives.map(function (o, i) { return '<li' + (i < st ? '' : '') + '>' + esc(o.text) + '</li>'; }).join('') + '</ul><small>Recompensa: ' + esc(l.reward) + (pr.best[l.id] ? ' · Tu mejor vuelta: ' + t2(pr.best[l.id]) : '') + '</small><button class="go" data-act="lvl" data-val="' + l.id + '">' + (pr.done[l.id] ? 'Repetir' : 'Jugar') + '</button>' : '<small>🔒 ' + esc(l.unlock) + '</small>') + '</div>';
          }).join('') + '</div><div class="btns"><button data-act="back">Volver</button></div></div>'; break;
      }
      case 'setup': {
        var spec = CARS[s.carId], st = statsOf(spec), tt = data === 'tt';
        h = '<div class="panel left wide"><h2>' + (tt ? 'Contrarreloj' : 'Carrera') + '</h2>' +
          '<div class="cars">' + Object.keys(CARS).map(function (id) { var c = CARS[id]; return '<button class="car' + (id === s.carId ? ' on' : '') + '" data-act="car" data-val="' + id + '"><b>' + c.name + '</b><small>' + c.blurb + '</small></button>'; }).join('') + '</div>' +
          '<div class="stats">' + [['Potencia', st.pot], ['Ligereza', st.peso], ['Agarre', st.agarre], ['Carga aero', st.aero]].map(function (a) { return '<div>' + a[0] + bar(a[1]) + '</div>'; }).join('') + '<div class="spec">' + spec.mass + ' kg · ' + Math.round(spec.torquePeak * spec.rpmPeak / 9549 * 1.34) + ' CV aprox · ' + spec.gears.length + ' marchas</div></div>' +
          row('Pintura', '<div class="paints">' + PAINTS.map(function (c, i) { return '<button class="sw' + (c === s.paint ? ' on' : '') + '" title="' + PAINT_NAMES[i] + '" style="background:' + hex(c) + '" data-act="paint" data-val="' + i + '"></button>'; }).join('') + '</div>') +
          row('Hora', sel('time', [['noon', 'Mediodía'], ['sunset', 'Atardecer'], ['night', 'Noche']], s.time)) +
          row('Clima', sel('weather', [['clear', 'Despejado'], ['rain', 'Lluvia'], ['snow', 'Nieve']], s.weather)) +
          row('Vueltas', sel('laps', [[1, 1], [2, 2], [3, 3], [5, 5], [8, 8]], s.laps)) +
          (tt ? '' : row('Rivales', sel('rivals', [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [7, 7]], s.rivals)) + row('Dificultad IA', sel('diff', [['easy', 'Fácil'], ['normal', 'Normal'], ['hard', 'Difícil'], ['pro', 'Pro']], s.diff)) +
            row('Objetos (cajas)', sel('items', [[1, 'Sí'], [0, 'No']], s.items === false ? 0 : 1)) +
            row('Obstáculos en pista', sel('obstacles', [[1, 'Sí'], [0, 'No']], s.obstacles === false ? 0 : 1)) +
            row('Clasificación previa', sel('quali', [[1, 'Sí (2 vueltas, tú solo en pista; tiempos de rivales simulados)'], [0, 'No (parrilla por sorteo)']], s.quali ? 1 : 0))) +
          row('Ayudas', sel('assists', [['full', 'Completas (ABS+TC+estabilidad)'], ['mid', 'Medias (ABS+TC)'], ['none', 'Sin ayudas']], s.assists)) +
          '<div class="btns"><button class="go" data-act="start" data-val="' + (tt ? 'tt' : 'race') + '">' + (tt ? 'Salir a pista' : (s.quali ? 'Ir a clasificación' : 'Ir a la parrilla')) + '</button><button data-act="back">Volver</button></div></div>'; break;
      }
      case 'settings':
        h = '<div class="panel left wide"><h2>Ajustes</h2>' +
          row('Calidad gráfica', sel('quality', [['ultra', 'Ultra'], ['high', 'Alta'], ['medium', 'Media'], ['low', 'Baja']], s.quality)) +
          row('Resolución de render', '<input type="range" data-set="scale" min="0.5" max="1.5" step="0.05" value="' + s.scale + '"><span class="val" id="v_scale">' + Math.round(s.scale * 100) + '%</span>') +
          row('Límite de FPS', sel('fps', [[30, '30'], [60, '60'], [90, '90'], [120, '120'], [0, 'Sin límite']], s.fps)) +
          row('Resolución dinámica', '<input type="checkbox" data-set="dyn"' + (s.dyn ? ' checked' : '') + '>') +
          row('Mostrar FPS', '<input type="checkbox" data-set="showFps"' + (s.showFps ? ' checked' : '') + '>') +
          row('Volumen general', '<input type="range" data-set="vol_master" min="0" max="1" step="0.05" value="' + s.vol.master + '">') +
          row('Música', '<input type="range" data-set="vol_music" min="0" max="1" step="0.05" value="' + s.vol.music + '">') +
          row('Motores', '<input type="range" data-set="vol_engine" min="0" max="1" step="0.05" value="' + s.vol.engine + '">') +
          row('Efectos y ambiente', '<input type="range" data-set="vol_sfx" min="0" max="1" step="0.05" value="' + s.vol.sfx + '">') +
          '<div class="btns"><button data-act="fullscreen">Pantalla completa</button><button class="go" data-act="back">Hecho</button></div>' +
          '<p class="hint">La calidad cambia al instante: sombras, antialiasing, reflejos, bloom, vegetación y partículas. La resolución de texturas se aplica al reiniciar el juego.</p></div>'; break;
      case 'controls':
        h = '<div class="panel left wide"><h2>Controles</h2><table class="keys">' +
          [['Acelerar', '↑ / W', 'Gatillo derecho'], ['Frenar / marcha atrás', '↓ / S', 'Gatillo izquierdo'], ['Girar', '← → / A D', 'Stick izquierdo'], ['Freno de mano', 'Espacio', 'Botón A'], ['Volver a pista', 'R (+3 s de penalización)', 'Botón Y'], ['Pausa', 'Esc / P', 'Start'], ['Silenciar', 'M', '—']].map(function (r) { return '<tr><td>' + r[0] + '</td><td><kbd>' + r[1] + '</kbd></td><td>' + r[2] + '</td></tr>'; }).join('') +
          '</table><p class="hint">Cámara siempre en tercera persona detrás del coche. Caja de cambios automática; ABS, control de tracción y estabilidad configurables en la pantalla de preparación.</p><div class="btns"><button class="go" data-act="back">Volver</button></div></div>'; break;
      case 'pause':
        h = '<div class="panel center2"><h2>Pausa</h2><button class="big" data-act="resume">Continuar</button><button class="big" data-act="restart">Reiniciar evento</button><button class="big" data-act="settings_p">Ajustes</button><button class="big" data-act="quit">Salir al menú</button></div>'; break;
      case 'qualiSummary': {
        var rows = data.rows;
        h = '<div class="panel center2 wide"><h2>Resultado de clasificación</h2><table class="tbl"><tr><th>#</th><th>Piloto</th><th>Coche</th><th>Mejor vuelta</th><th>Dif.</th></tr>' +
          rows.map(function (r, i) { return '<tr class="' + (r.isPlayer ? 'me' : '') + '"><td>' + (i + 1) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.model) + '</td><td>' + t2(r.time) + '</td><td>' + (i ? '+' + (r.time - rows[0].time).toFixed(3) : '') + '</td></tr>'; }).join('') +
          '</table><p class="hint">Tu salida: <b>P' + data.playerPos + '</b></p><div class="btns"><button class="go" data-act="toGrid">Ir a la parrilla</button><button data-act="retryQuali">Repetir clasificación</button></div></div>'; break;
      }
      case 'ttSummary':
        h = '<div class="panel center2 wide"><h2>Contrarreloj completada</h2><table class="tbl"><tr><th>Vuelta</th><th>Tiempo</th></tr>' + data.laps.map(function (t, i) { return '<tr class="' + (t === data.best ? 'me' : '') + '"><td>' + (i + 1) + (i === 0 ? ' (salida lanzada)' : '') + '</td><td>' + t2(t) + '</td></tr>'; }).join('') +
          '</table><p class="hint">Mejor vuelta lanzada: <b>' + t2(data.best) + '</b>' + (data.record ? ' · ¡NUEVO RÉCORD PERSONAL!' : '') + '</p><div class="btns"><button class="go" data-act="restart">Repetir</button><button data-act="quit">Menú</button></div></div>'; break;
      case 'results': {
        var banner = data.place === 1 ? ['VICTORIA', 'win'] : (data.place <= 3 ? ['PODIO', 'pod'] : ['DERROTA', 'lose']);
        h = '<div class="panel center2 wide ' + banner[1] + '"><div class="banner ' + banner[1] + '">' + banner[0] + '</div><h3>Has terminado P' + data.place + ' de ' + data.rows.length + '</h3>' +
          '<table class="tbl"><tr><th>#</th><th>Piloto</th><th>Coche</th><th>Tiempo</th><th>Mejor vuelta</th></tr>' +
          data.rows.map(function (r) { return '<tr class="' + (r.isPlayer ? 'me' : '') + '"><td>' + r.place + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.model) + '</td><td>' + (r.finished ? (r.place === 1 ? t2(r.time) : '+' + (r.gapTime || 0).toFixed(3)) : (r.lapsDown ? '+' + r.lapsDown + ' vuelta' + (r.lapsDown > 1 ? 's' : '') : 'En pista')) + '</td><td>' + t2(r.best) + '</td></tr>'; }).join('') +
          '</table>' + (data.camp ? (function (c) { return '<div class="campres"><h3>Nivel ' + c.level.id + ' · ' + esc(c.level.name) + (c.eval.completed ? ' — COMPLETADO' : ' — no completado') + '</h3><ul>' + c.level.objectives.map(function (o, i) { return '<li>' + (c.eval.stars[i] ? '★' : '☆') + ' ' + esc(o.text) + '</li>'; }).join('') + '</ul><p class="hint">Estrellas: <b>' + c.stars + '/3</b> · Total ' + c.points + ' pts' + (c.unlocked ? ' · <b>¡Nivel ' + c.unlocked + ' desbloqueado!</b>' : '') + (c.champion ? ' · <b>¡CAMPEÓN DEL MUNDO!</b>' : '') + '</p></div>'; })(data.camp) : '') +
          '<div class="btns"><button class="go" data-act="podium">Ver podio</button>' + (data.camp && data.camp.eval.completed && data.camp.level.id < 10 ? '<button class="go" data-act="lvl_next">Siguiente nivel</button>' : '') + '<button data-act="restart">Repetir</button>' + (data.camp ? '<button data-act="campaign">Niveles</button>' : '') + '<button data-act="quit">Menú</button></div></div>'; break;
      }
      case 'podium':
        h = '<div class="podiumbar"><button data-act="results_back">Resultados</button><button data-act="restart">Repetir</button><button data-act="quit">Menú</button></div>'; break;

      case 'online': {
        var D = data || {}, stTxt = { nourl: 'Abre el juego desde el servidor (http://…) para jugar online', connecting: 'Conectando…', reconnecting: 'Reconectando…', online: 'Conectado · ' + Math.round(D.rtt || 0) + ' ms', error: 'Error de conexión', lost: 'Conexión perdida', idle: 'Sin conexión' }[D.status] || '', dotc = D.status === 'online' ? 'ok' : (D.status === 'connecting' || D.status === 'reconnecting' ? 'warn' : 'bad'), on = D.status === 'online';
        h = '<div class="panel left wide"><h2>Online</h2><p class="netstat"><i class="dot ' + dotc + '"></i>' + stTxt + '</p>' +
          row('Nombre de piloto', '<input type="text" class="txt" data-set="o_name" maxlength="16" value="' + esc(D.name || '') + '">') +
          '<div class="btns"><button class="go" data-act="o_quick"' + (on ? '' : ' disabled') + '>Jugar online</button><button data-act="o_create"' + (on ? '' : ' disabled') + '>Crear sala</button></div>' +
          '<h3>Unirse a una sala</h3>' +
          '<div class="rooms">' + ((D.rooms && D.rooms.length) ? D.rooms.map(function (r) { return '<div class="roomrow"><b>' + esc(r.code) + '</b><span>' + esc(r.host) + ' · ' + r.n + '/' + r.max + ' · ' + r.laps + ' vueltas</span><button data-act="o_join" data-val="' + esc(r.code) + '">Unirse</button></div>'; }).join('') : '<p class="hint">No hay salas públicas abiertas. Crea una o entra con un código.</p>') + '</div>' +
          '<div class="btns"><button data-act="o_list"' + (on ? '' : ' disabled') + '>Actualizar lista</button></div>' +
          row('Código de sala', '<input type="text" class="txt code" data-set="o_code" maxlength="5" placeholder="ABCDE" value="' + esc(D.code || '') + '"><button data-act="o_joinCode"' + (on ? '' : ' disabled') + '>Entrar</button>') +
          (D.err ? '<p class="err">' + esc(D.err) + '</p>' : '') +
          '<div class="btns"><button data-act="o_exit">Volver</button></div></div>'; break;
      }
      case 'lobby': {
        var L = data, rm = L.room, me = L.me, isHost = rm.host === me, mine = rm.players.find(function (p) { return p.pid === me; }) || {}, nready = rm.players.filter(function (p) { return p.ready; }).length;
        var dis = isHost ? '' : ' disabled', guests = rm.players.filter(function (p) { return p.pid !== rm.host; }), canStart = isHost && rm.players.length >= 2 && rm.players.every(function (p) { return p.connected; }) && guests.every(function (p) { return p.ready; });
        h = '<div class="panel left wide"><h2>Sala <span class="roomcode">' + esc(rm.code) + '</span></h2><p class="hint">Comparte este código con tus amigos para que entren. ' + (rm.priv ? 'Sala privada.' : 'Sala pública (aparece en la lista).') + '</p>' +
          '<table class="tbl"><tr><th></th><th>Piloto</th><th>Coche</th><th>Ping</th><th>Estado</th><th></th></tr>' +
          rm.players.map(function (p) { var c = JR.vehicle.CARS[p.car]; return '<tr class="' + (p.pid === me ? 'me' : '') + '"><td><span class="pdot" style="background:' + hex(p.paint) + '"></span></td><td>' + (p.pid === rm.host ? '★ ' : '') + esc(p.name) + '</td><td>' + esc(c ? c.name : p.car) + '</td><td><i class="dot ' + (p.connected ? 'ok' : 'bad') + '"></i>' + (p.connected ? (p.pid === me ? Math.round(L.rtt || 0) : p.rtt) + ' ms' : 'sin conexión') + '</td><td>' + (p.pid === rm.host ? '<b>ANFITRIÓN</b>' : (p.ready ? '<b class="rdy">LISTO</b>' : 'NO LISTO')) + '</td><td>' + (isHost && p.pid !== me ? '<button data-act="o_kick" data-val="' + p.pid + '">Expulsar</button>' : '') + '</td></tr>'; }).join('') + '</table>' +
          '<p class="hint">' + rm.players.length + '/' + rm.max + ' jugadores · ' + (nready + (rm.players.some(function (p) { return p.pid === rm.host; }) ? 0 : 0)) + ' listos · ' + (isHost ? 'cuando todos los invitados estén LISTOS podrás iniciar la carrera (mínimo 2 jugadores).' : 'pulsa LISTO; el anfitrión inicia la carrera.') + '</p>' +
          '<div class="cars">' + Object.keys(CARS).map(function (id) { var c = CARS[id]; return '<button class="car' + (id === mine.car ? ' on' : '') + '" data-act="o_car" data-val="' + id + '"><b>' + c.name + '</b><small>' + c.blurb + '</small></button>'; }).join('') + '</div>' +
          row('Pintura', '<div class="paints">' + PAINTS.map(function (c, i) { return '<button class="sw' + (c === mine.paint ? ' on' : '') + '" title="' + PAINT_NAMES[i] + '" style="background:' + hex(c) + '" data-act="o_paint" data-val="' + i + '"></button>'; }).join('') + '</div>') +
          row('Ayudas', '<select data-set="o_assists">' + [['full', 'Completas'], ['mid', 'Medias'], ['none', 'Sin ayudas']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === s.assists ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>') +
          row('Circuito', '<select data-set="o_circuit"' + dis + '>' + JR.levels.LEVELS.map(function (l) { return '<option value="' + l.id + '"' + (l.id === rm.circuit ? ' selected' : '') + '>' + l.id + '. ' + esc(JR.levels.SCENES[l.scene].name) + '</option>'; }).join('') + '</select>') +
          row('Máx. jugadores', '<select data-set="o_max"' + dis + '>' + [2, 3, 4, 5].map(function (n) { return '<option value="' + n + '"' + (n === rm.max ? ' selected' : '') + (n < rm.players.length ? ' disabled' : '') + '>' + n + '</option>'; }).join('') + '</select>') +
          row('Rivales IA (opcional)', '<select data-set="o_bots"' + dis + '>' + [0, 1, 2, 3].filter(function (n) { return n + rm.players.length <= rm.max; }).map(function (n) { return '<option value="' + n + '"' + (n === (rm.bots || 0) ? ' selected' : '') + '>' + (n ? n + ' (se marcan como BOT)' : 'Ninguno') + '</option>'; }).join('') + '</select>') +
          row('Vueltas', '<select data-set="o_laps"' + dis + '>' + [1, 2, 3, 5, 8].map(function (n) { return '<option value="' + n + '"' + (n === rm.laps ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select>') +
          row('Hora', '<select data-set="o_time"' + dis + '>' + [['noon', 'Mediodía'], ['sunset', 'Atardecer'], ['night', 'Noche']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === rm.time ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>') +
          row('Clima', '<select data-set="o_weather"' + dis + '>' + [['clear', 'Despejado'], ['rain', 'Lluvia'], ['snow', 'Nieve']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === rm.weather ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>') +
          row('Visibilidad', '<select data-set="o_priv"' + dis + '><option value="1"' + (rm.priv ? ' selected' : '') + '>Privada (solo con código)</option><option value="0"' + (rm.priv ? '' : ' selected') + '>Pública (en la lista)</option></select>') +
          (L.err ? '<p class="err">' + esc(L.err) + '</p>' : '') +
          '<div class="btns">' + (isHost ? '<button class="go" data-act="o_start"' + (canStart ? '' : ' disabled') + '>Iniciar carrera</button><button data-act="o_close">Cerrar sala</button>' : '<button class="go" data-act="o_ready">' + (mine.ready ? 'Cancelar listo' : 'Listo') + '</button>') + '<button data-act="o_leave">Abandonar sala</button></div></div>'; break;
      }
      case 'oresults': {
        var ban = data.place === 1 ? ['VICTORIA', 'win'] : (data.place <= 3 && data.rows.length > 2 ? ['PODIO', 'pod'] : ['DERROTA', 'lose']);
        h = '<div class="panel center2 wide ' + ban[1] + '"><div class="banner ' + ban[1] + '">' + ban[0] + '</div><h3>Has terminado P' + data.place + ' de ' + data.rows.length + '</h3>' +
          '<table class="tbl"><tr><th>#</th><th>Piloto</th><th>Coche</th><th>Tiempo</th><th>Mejor vuelta</th></tr>' +
          data.rows.map(function (r) { return '<tr class="' + (r.isPlayer ? 'me' : '') + '"><td>' + r.place + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.model) + '</td><td>' + (r.finished ? (r.place === 1 ? t2(r.time) : '+' + (r.gapTime || 0).toFixed(3)) : (r.left ? 'Abandonó' : 'No terminó')) + '</td><td>' + t2(r.best) + '</td></tr>'; }).join('') +
          '</table><div class="btns"><button class="go" data-act="o_again">Volver a la sala</button><button data-act="o_leave">Salir al menú</button></div></div>'; break;
      }
      case 'pauseO':
        h = '<div class="panel center2"><h2>Menú</h2><p class="hint">La carrera online continúa mientras tienes el menú abierto.</p><button class="big" data-act="resume">Continuar</button><button class="big" data-act="settings_p">Ajustes</button><button class="big" data-act="o_leave">Abandonar la carrera</button></div>'; break;
      default: h = '';
    }
    this.root.innerHTML = h; this.root.className = 'ui ' + name + (h ? '' : ' empty');
    var self = this;
    var rs = this.root.querySelector('[data-set="scale"]'); if (rs) rs.addEventListener('input', function () { var v = document.getElementById('v_scale'); if (v) v.textContent = Math.round(rs.value * 100) + '%'; });
  };
  UI.prototype.hide = function () { this.screen = null; this.root.innerHTML = ''; this.root.className = 'ui empty'; };
  UI.prototype.progress = function (f, txt) { var b = document.getElementById('loadbar'); if (b) b.style.width = Math.round(f * 100) + '%'; var t = document.getElementById('loadtxt'); if (t && txt) t.textContent = txt; };

  /* ------------------------------------------------------------------ HUD */
  UI.prototype.resize = function (w, h, dpr) {
    this.dpr = dpr; this.W = w; this.H = h; this.hud.width = Math.round(w * dpr); this.hud.height = Math.round(h * dpr); this.hud.style.width = w + 'px'; this.hud.style.height = h + 'px';
  };
  UI.prototype.message = function (txt, kind, dur) { this.msgs.push({ t: txt, k: kind || 'info', life: dur || 2.4, max: dur || 2.4 }); if (this.msgs.length > 4) this.msgs.shift(); };
  UI.prototype.checkpointDelta = function (d) { this.cpDelta = { d: d, life: 3 }; };

  UI.prototype._buildMini = function (track) {
    var N = track.N, step = 3, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, i;
    for (i = 0; i < N; i += step) { minX = Math.min(minX, track.x[i]); maxX = Math.max(maxX, track.x[i]); minZ = Math.min(minZ, track.z[i]); maxZ = Math.max(maxZ, track.z[i]); }
    var size = 190, pad = 10, sc = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    var cv = document.createElement('canvas'); cv.width = cv.height = size * 2; var c = cv.getContext('2d'); c.scale(2, 2);
    var ox = pad + ((size - pad * 2) - (maxX - minX) * sc) / 2, oz = pad + ((size - pad * 2) - (maxZ - minZ) * sc) / 2;
    function P(x, z) { return [ox + (x - minX) * sc, size - (oz + (z - minZ) * sc)]; }
    c.lineJoin = 'round'; c.lineCap = 'round';
    [[9, 'rgba(0,0,0,0.65)'], [5.5, 'rgba(235,235,240,0.9)'], [3.2, 'rgba(40,42,50,1)']].forEach(function (L) {
      c.lineWidth = L[0]; c.strokeStyle = L[1]; c.beginPath();
      for (var k = 0; k <= N; k += step) { var p = P(track.x[k % N], track.z[k % N]); if (k === 0) c.moveTo(p[0], p[1]); else c.lineTo(p[0], p[1]); }
      c.closePath(); c.stroke();
    });
    var a = P(track.x[0], track.z[0]); c.fillStyle = '#fff'; c.fillRect(a[0] - 4, a[1] - 1.5, 8, 3);
    this.mini = { cv: cv, P: P, size: size };
  };

  UI.prototype.draw = function (S) {
    var c = this.hctx, W = this.W, H = this.H, dpr = this.dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    if (!S || !S.hud) { if (S && S.fps) this._fps(c, S); return; }
    var sim = S.sim, car = S.player, v = car.vehicle, sc = clamp(Math.min(W / 1500, H / 840), 0.62, 1.35), env = S.env;
    c.save(); c.textBaseline = 'alphabetic';
    // ---------- speed / rpm / gear dial (bottom right)
    var cx = W - 150 * sc - 24, cy = H - 140 * sc - 18, R = 118 * sc;
    this._dial(c, cx, cy, R, v, sc, S);
    // ---------- top-left: position + lap + timers
    var race = sim.mode === 'race', r = car.race, n = sim.cars.length;
    var x0 = 22 * sc, y0 = 20 * sc;
    c.fillStyle = 'rgba(8,10,16,0.62)'; this._rr(c, x0, y0, 290 * sc, 134 * sc, 10 * sc); c.fill();
    c.fillStyle = '#e8412c'; c.fillRect(x0, y0 + 8 * sc, 4 * sc, 118 * sc);
    if (race) { c.font = 'italic 800 ' + 54 * sc + 'px "Segoe UI",Arial,sans-serif'; c.fillStyle = '#fff'; c.fillText(r.place, x0 + 20 * sc, y0 + 62 * sc); var wP = c.measureText(String(r.place)).width; c.font = '600 ' + 22 * sc + 'px "Segoe UI",Arial'; c.fillStyle = '#9ba3b4'; c.fillText('/' + n, x0 + 22 * sc + wP, y0 + 62 * sc); }
    var lapNow = Math.min(r.lapsDone + 1, S.totalLaps);
    c.font = '700 ' + 17 * sc + 'px "Segoe UI",Arial'; c.fillStyle = '#e8ecf4'; c.textAlign = 'right';
    c.fillText((race ? 'VUELTA ' : 'VUELTA ') + lapNow + '/' + S.totalLaps, x0 + 276 * sc, y0 + 32 * sc);
    c.textAlign = 'left'; c.font = '600 ' + 13 * sc + 'px "Segoe UI",Arial'; c.fillStyle = '#8f98ab';
    var lapT = r.started && !r.finished ? sim.t - r.lapStartT : (r.finished ? (r.lapTimes[r.lapTimes.length - 1] || 0) : 0);
    var rows = [['VUELTA', t2(Math.max(0, lapT))], ['ÚLTIMA', t2(r.lapTimes.length ? r.lapTimes[r.lapTimes.length - 1] : null)], ['MEJOR', t2(r.bestLap)]];
    for (var i = 0; i < 3; i++) { c.fillStyle = '#8f98ab'; c.textAlign = 'left'; c.font = '600 ' + 12 * sc + 'px "Segoe UI",Arial'; c.fillText(rows[i][0], x0 + 20 * sc, y0 + (88 + i * 17) * sc); c.textAlign = 'right'; c.font = '700 ' + 15 * sc + 'px "Consolas","Courier New",monospace'; c.fillStyle = i === 2 ? '#7dffa6' : '#fff'; c.fillText(rows[i][1], x0 + 276 * sc, y0 + (88 + i * 17) * sc); }
    c.textAlign = 'left';
    if (sim.itemsOn) this._itemHud(c, S, sc);
    // ---------- standings (left middle)
    if (race && S.standings) this._standings(c, S, x0, y0 + 150 * sc, sc);
    else if (!race) { c.fillStyle = 'rgba(8,10,16,0.55)'; this._rr(c, x0, y0 + 150 * sc, 290 * sc, 44 * sc, 10 * sc); c.fill(); c.fillStyle = '#c9d0de'; c.font = '600 ' + 13 * sc + 'px "Segoe UI",Arial'; c.fillText(S.ttBest ? 'RÉCORD PERSONAL  ' + t2(S.ttBest) : 'Sin récord guardado', x0 + 16 * sc, y0 + 178 * sc); }
    // ---------- minimap (top right)
    if (this.mini) {
      var ms = this.mini.size * sc * 0.9, mx = W - ms - 22 * sc, my = 20 * sc;
      c.fillStyle = 'rgba(8,10,16,0.55)'; this._rr(c, mx - 4, my - 4, ms + 8, ms + 8, 12 * sc); c.fill();
      c.drawImage(this.mini.cv, mx, my, ms, ms);
      var k = ms / this.mini.size;
      for (i = 0; i < sim.cars.length; i++) {
        var cc = sim.cars[i], p = this.mini.P(cc.vehicle.x, cc.vehicle.z);
        c.beginPath(); c.arc(mx + p[0] * k, my + p[1] * k, (cc.isPlayer ? 5.2 : 3.6) * sc, 0, 6.283); c.fillStyle = hex(cc.color); c.fill(); c.lineWidth = cc.isPlayer ? 2 * sc : 1.2 * sc; c.strokeStyle = cc.isPlayer ? '#fff' : '#000'; c.stroke();
      }
      var pp = this.mini.P(v.x, v.z), ax = mx + pp[0] * k, ay = my + pp[1] * k, hd = v.heading;
      c.save(); c.translate(ax, ay); c.rotate(Math.PI - hd * -1 + Math.PI); c.restore();
      c.beginPath(); c.moveTo(ax + Math.sin(hd) * 10 * sc, ay - Math.cos(hd) * 10 * sc); c.lineTo(ax + Math.sin(hd + 2.5) * 5 * sc, ay - Math.cos(hd + 2.5) * 5 * sc); c.lineTo(ax + Math.sin(hd - 2.5) * 5 * sc, ay - Math.cos(hd - 2.5) * 5 * sc); c.closePath(); c.fillStyle = '#fff'; c.fill();
    }
    // ---------- competitor info (car ahead / behind)
    if (race && S.near) this._near(c, S, W / 2, H - 70 * sc, sc);
    // ---------- start lights
    if (sim.state === 'countdown' || this.goT > 0) this._lights(c, sim, W / 2, 80 * sc, sc);
    // ---------- messages + checkpoint delta + wrong way
    this._messages(c, W / 2, 150 * sc, sc);
    if (this.cpDelta && this.cpDelta.life > 0) { var d = this.cpDelta.d, col = d <= 0 ? '#7dffa6' : '#ff6b5e'; c.globalAlpha = clamp(this.cpDelta.life, 0, 1); c.font = 'italic 800 ' + 34 * sc + 'px "Segoe UI",Arial'; c.textAlign = 'center'; c.fillStyle = 'rgba(0,0,0,.5)'; c.fillText((d > 0 ? '+' : '') + d.toFixed(2), W / 2 + 2, 250 * sc + 2); c.fillStyle = col; c.fillText((d > 0 ? '+' : '') + d.toFixed(2), W / 2, 250 * sc); c.globalAlpha = 1; c.textAlign = 'left'; }
    if (r.wrongWay > 1.5) { c.textAlign = 'center'; c.font = 'italic 800 ' + 44 * sc + 'px "Segoe UI",Arial'; c.fillStyle = 'rgba(255,60,50,' + (0.6 + 0.4 * Math.sin(S.time * 8)) + ')'; c.fillText('¡CONTRAMANO!', W / 2, H * 0.36); c.textAlign = 'left'; }
    // damage
    this._damage(c, car, 24 * sc, H - 120 * sc, sc);
    if (S.fps) this._fps(c, S);
    // red flash on impact
    if (this.flash > 0) { var g = c.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85); g.addColorStop(0, 'rgba(255,40,20,0)'); g.addColorStop(1, 'rgba(255,40,20,' + clamp(this.flash, 0, 0.45) + ')'); c.fillStyle = g; c.fillRect(0, 0, W, H); }
    if (S.tags) this._tags(c, S.tags, sc);
    if (S.netInfo) this._netInfo(c, S.netInfo, sc);
    c.restore();
  };
  UI.prototype._tags = function (c, tags, sc) {
    c.textAlign = 'center'; c.font = '700 ' + 14 * sc + 'px "Segoe UI",Arial';
    for (var i = 0; i < tags.length; i++) {
      var t = tags[i], a = clamp(1.25 - t.d / 160, 0.25, 1), w = c.measureText(t.name).width + 18 * sc;
      c.globalAlpha = a; c.fillStyle = 'rgba(8,10,16,.72)'; this._rr(c, t.x - w / 2, t.y - 16 * sc, w, 22 * sc, 6 * sc); c.fill();
      c.fillStyle = t.ahead ? '#ffd23f' : '#ffffff'; c.fillText(t.name, t.x, t.y);
      c.font = '600 ' + 11 * sc + 'px "Segoe UI",Arial'; c.fillStyle = '#aeb6c8'; c.fillText('P' + t.place + ' · ' + Math.round(t.d) + ' m', t.x, t.y + 17 * sc); c.font = '700 ' + 14 * sc + 'px "Segoe UI",Arial';
    }
    c.globalAlpha = 1;
  };
  UI.prototype._netInfo = function (c, n, sc) {
    var W = this.W, ok = n.status === 'online', txt = ok ? 'ONLINE · ' + Math.round(n.ping) + ' ms · ' + n.players + ' pilotos' : (n.status === 'reconnecting' ? 'RECONECTANDO…' : 'SIN CONEXIÓN');
    c.font = '700 ' + 12 * sc + 'px "Segoe UI",Arial'; c.textAlign = 'center'; var w = c.measureText(txt).width + 34 * sc;
    c.fillStyle = 'rgba(8,10,16,.62)'; this._rr(c, W / 2 - w / 2, 8 * sc, w, 22 * sc, 11 * sc); c.fill();
    c.fillStyle = ok ? (n.ping < 90 ? '#4be37a' : (n.ping < 180 ? '#ffd23f' : '#ff7a3d')) : '#ff4a3d'; c.beginPath(); c.arc(W / 2 - w / 2 + 13 * sc, 19 * sc, 4 * sc, 0, 6.283); c.fill();
    c.fillStyle = '#e8ecf4'; c.fillText(txt, W / 2 + 7 * sc, 23 * sc);
    if (!ok) { c.font = 'italic 800 ' + 36 * sc + 'px "Segoe UI",Arial'; c.fillStyle = 'rgba(255,200,60,.9)'; c.fillText(txt, W / 2, this.H * 0.3); }
  };
  UI.prototype.update = function (dt) {
    for (var i = this.msgs.length - 1; i >= 0; i--) { this.msgs[i].life -= dt; if (this.msgs[i].life <= 0) this.msgs.splice(i, 1); }
    if (this.cpDelta) this.cpDelta.life -= dt; if (this.goT > 0) this.goT -= dt; if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 1.2);
  };

  UI.prototype._rr = function (c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };

  UI.prototype._dial = function (c, cx, cy, R, v, sc, S) {
    var spec = v.spec, a0 = Math.PI * 0.78, a1 = Math.PI * 2.22, max = Math.ceil(spec.rpmRedline / 1000) * 1000 + 500, i;
    c.fillStyle = 'rgba(8,10,16,0.66)'; c.beginPath(); c.arc(cx, cy, R + 12 * sc, 0, 6.283); c.fill();
    c.lineWidth = 9 * sc; c.lineCap = 'butt'; c.strokeStyle = 'rgba(255,255,255,0.12)'; c.beginPath(); c.arc(cx, cy, R, a0, a1); c.stroke();
    var rf = clamp((v.rpm) / max, 0, 1), redF = spec.rpmRedline * 0.93 / max;
    var grd = c.createLinearGradient(cx - R, cy, cx + R, cy); grd.addColorStop(0, '#39d0ff'); grd.addColorStop(0.65, '#ffffff'); grd.addColorStop(1, '#ff3b2e');
    c.strokeStyle = rf > redF ? '#ff3b2e' : grd; c.beginPath(); c.arc(cx, cy, R, a0, a0 + (a1 - a0) * rf); c.stroke();
    c.strokeStyle = 'rgba(255,50,40,0.9)'; c.lineWidth = 3 * sc; c.beginPath(); c.arc(cx, cy, R + 8 * sc, a0 + (a1 - a0) * redF, a1); c.stroke();
    c.fillStyle = '#d6dbe8'; c.font = '600 ' + 12 * sc + 'px "Segoe UI",Arial'; c.textAlign = 'center';
    for (i = 0; i <= max / 1000; i++) {
      var f = i * 1000 / max, a = a0 + (a1 - a0) * f, ca = Math.cos(a), sa = Math.sin(a);
      c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 2 * sc; c.beginPath(); c.moveTo(cx + ca * (R - 8 * sc), cy + sa * (R - 8 * sc)); c.lineTo(cx + ca * (R - 17 * sc), cy + sa * (R - 17 * sc)); c.stroke();
      c.fillText(String(i), cx + ca * (R - 30 * sc), cy + sa * (R - 30 * sc) + 4 * sc);
    }
    c.fillStyle = '#fff'; c.font = 'italic 800 ' + 62 * sc + 'px "Segoe UI",Arial'; c.fillText(String(Math.round(Math.abs(v.speedKmh))), cx, cy + 22 * sc);
    c.font = '600 ' + 13 * sc + 'px "Segoe UI",Arial'; c.fillStyle = '#9ba3b4'; c.fillText('km/h', cx, cy + 42 * sc);
    var gear = v.gear < 0 || v.reversing ? 'R' : (v.gear === 0 ? 'N' : String(v.gear));
    c.font = '800 ' + 40 * sc + 'px "Segoe UI",Arial'; c.fillStyle = rf > redF ? '#ff5a4a' : '#ffd23f'; c.fillText(gear, cx, cy - 34 * sc);
    // throttle / brake bars + assist lamps
    var bw = 8 * sc, bx = cx + R * 0.86, by = cy + R * 0.2;
    c.fillStyle = 'rgba(255,255,255,0.15)'; c.fillRect(bx, by - 52 * sc, bw, 52 * sc); c.fillRect(bx + 12 * sc, by - 52 * sc, bw, 52 * sc);
    c.fillStyle = '#7dffa6'; c.fillRect(bx, by - 52 * sc * clamp(S.input.throttle, 0, 1), bw, 52 * sc * clamp(S.input.throttle, 0, 1));
    c.fillStyle = '#ff5a4a'; c.fillRect(bx + 12 * sc, by - 52 * sc * clamp(S.input.brake, 0, 1), bw, 52 * sc * clamp(S.input.brake, 0, 1));
    c.font = '800 ' + 11 * sc + 'px "Segoe UI",Arial';
    c.fillStyle = v.absActive ? '#ffb020' : 'rgba(255,255,255,0.18)'; c.fillText('ABS', cx - 24 * sc, cy + 68 * sc);
    c.fillStyle = v.tcActive ? '#ffb020' : 'rgba(255,255,255,0.18)'; c.fillText('TC', cx + 24 * sc, cy + 68 * sc);
    c.textAlign = 'left';
  };
  /* item slot (bottom centre): icon of the held item, key hint, and live indicators for turbo / shield / slow */
  UI.prototype._itemHud = function (c, S, sc) {
    var car = S.player, W = this.W, H = this.H, size = 76 * sc, xc = W / 2 + 150 * sc, x = xc - size / 2, y = H - size - 26 * sc, it = car.item, T = S.time || 0;
    c.save();
    c.fillStyle = 'rgba(8,10,16,0.62)'; this._rr(c, x, y, size, size, 14 * sc); c.fill();
    c.lineWidth = 2.5 * sc; c.strokeStyle = it ? 'rgba(255,214,64,' + (0.65 + 0.35 * Math.sin(T * 6)) + ')' : 'rgba(255,255,255,0.18)'; this._rr(c, x, y, size, size, 14 * sc); c.stroke();
    var cx = x + size / 2, cy = y + size / 2 - 3 * sc, u = size * 0.3;
    c.translate(cx, cy);
    if (!it) { c.fillStyle = 'rgba(255,255,255,0.25)'; c.font = '800 ' + 30 * sc + 'px "Segoe UI",Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', 0, 2 * sc); }
    else {
      c.lineJoin = 'round'; c.lineCap = 'round';
      if (it === 'turbo' || it === 'double') {
        var n = it === 'double' ? 2 : 1;
        for (var k = 0; k < n; k++) { var oy = n === 2 ? (k ? 0.55 : -0.5) * u : 0; c.fillStyle = '#ffb21a'; c.beginPath(); c.moveTo(0.1 * u, -1.0 * u + oy); c.lineTo(-0.75 * u, 0.15 * u + oy); c.lineTo(-0.1 * u, 0.15 * u + oy); c.lineTo(-0.3 * u, 0.95 * u + oy); c.lineTo(0.8 * u, -0.2 * u + oy); c.lineTo(0.1 * u, -0.2 * u + oy); c.closePath(); c.fill(); }
      } else if (it === 'missile') {
        c.rotate(-Math.PI / 4); c.fillStyle = '#e8e8e8'; this._rr(c, -0.35 * u, -1.1 * u, 0.7 * u, 1.7 * u, 0.3 * u); c.fill();
        c.fillStyle = '#e03a2a'; c.beginPath(); c.moveTo(-0.35 * u, -1.0 * u); c.lineTo(0, -1.65 * u); c.lineTo(0.35 * u, -1.0 * u); c.closePath(); c.fill();
        c.fillStyle = '#222'; c.fillRect(-0.7 * u, 0.15 * u, 0.35 * u, 0.5 * u); c.fillRect(0.35 * u, 0.15 * u, 0.35 * u, 0.5 * u);
        c.fillStyle = '#ff9a1a'; c.beginPath(); c.moveTo(-0.22 * u, 0.62 * u); c.lineTo(0, 1.35 * u); c.lineTo(0.22 * u, 0.62 * u); c.closePath(); c.fill();
      } else if (it === 'trap') {
        c.fillStyle = '#1a1c22'; c.beginPath(); c.arc(0, 0, 0.95 * u, 0, 6.283); c.fill();
        c.fillStyle = '#e8a010'; for (var q = 0; q < 8; q++) { var a = q / 8 * 6.283; c.beginPath(); c.moveTo(Math.cos(a - 0.2) * 0.55 * u, Math.sin(a - 0.2) * 0.55 * u); c.lineTo(Math.cos(a) * 1.25 * u, Math.sin(a) * 1.25 * u); c.lineTo(Math.cos(a + 0.2) * 0.55 * u, Math.sin(a + 0.2) * 0.55 * u); c.closePath(); c.fill(); }
        c.fillStyle = '#e8412c'; c.beginPath(); c.arc(0, 0, 0.3 * u, 0, 6.283); c.fill();
      } else if (it === 'shield') {
        c.fillStyle = '#3aa0ff'; c.beginPath(); c.moveTo(0, -1.1 * u); c.lineTo(0.95 * u, -0.7 * u); c.lineTo(0.8 * u, 0.4 * u); c.lineTo(0, 1.15 * u); c.lineTo(-0.8 * u, 0.4 * u); c.lineTo(-0.95 * u, -0.7 * u); c.closePath(); c.fill();
        c.fillStyle = '#bfe3ff'; c.beginPath(); c.moveTo(0, -0.75 * u); c.lineTo(0.62 * u, -0.5 * u); c.lineTo(0.5 * u, 0.25 * u); c.lineTo(0, 0.78 * u); c.closePath(); c.fill();
      }
    }
    c.restore(); c.save();
    c.textAlign = 'center'; c.fillStyle = it ? '#ffd23f' : '#6b7385'; c.font = '800 ' + 11 * sc + 'px "Segoe UI",Arial';
    c.fillText(it ? (JR.items.NAMES[it] + ' · [E]') : 'SIN OBJETO', xc, y + size - 7 * sc);
    // live effect bars above the slot
    var bars = [];
    if (car.boostT > 0 || car.boostGap > 0) bars.push(['TURBO', car.boostT > 0 ? clamp(car.boostT / 2.6, 0, 1) : 0.15, '#ffa31a']);
    if (car.shieldT > 0) bars.push(['ESCUDO', clamp(car.shieldT / 7, 0, 1), '#3aa0ff']);
    if (car.slowT > 0) bars.push(['RALENTIZADO', clamp(car.slowT / 3, 0, 1), '#e8412c']);
    for (var i = 0; i < bars.length; i++) {
      var bw = 150 * sc, bx = xc - bw / 2, by = y - (16 + i * 20) * sc;
      c.fillStyle = 'rgba(8,10,16,0.62)'; this._rr(c, bx, by, bw, 12 * sc, 6 * sc); c.fill();
      c.fillStyle = bars[i][2]; this._rr(c, bx + 2 * sc, by + 2 * sc, Math.max(4 * sc, (bw - 4 * sc) * bars[i][1]), 8 * sc, 4 * sc); c.fill();
      c.fillStyle = '#fff'; c.font = '700 ' + 9 * sc + 'px "Segoe UI",Arial'; c.fillText(bars[i][0], xc, by - 3 * sc);
    }
    c.restore();
  };
  UI.prototype._standings = function (c, S, x, y, sc) {
    var st = S.standings, n = st.length, show = Math.min(n, 8), rh = 23 * sc, w = 290 * sc, pl = S.player.race.place - 1, list = [], i;
    var leader = st[0];
    if (n <= 8) for (i = 0; i < n; i++) list.push(i);
    else { for (i = 0; i < 5; i++) list.push(i); if (pl >= 5) { if (pl > 5) list.push(-1); list.push(pl); } while (list.length < 8 && list[list.length - 1] < n - 1) list.push(list[list.length - 1] + 1); }
    c.fillStyle = 'rgba(8,10,16,0.55)'; this._rr(c, x, y, w, list.length * rh + 12 * sc, 10 * sc); c.fill();
    for (i = 0; i < list.length; i++) {
      var idx = list[i], yy = y + 6 * sc + i * rh; if (idx < 0) { c.fillStyle = '#6b7385'; c.font = '700 ' + 12 * sc + 'px "Segoe UI",Arial'; c.fillText('· · ·', x + 24 * sc, yy + 16 * sc); continue; }
      var car = st[idx], me = car.isPlayer;
      if (me) { c.fillStyle = 'rgba(232,65,44,0.35)'; c.fillRect(x + 4 * sc, yy, w - 8 * sc, rh - 2 * sc); }
      c.font = '800 ' + 13 * sc + 'px "Segoe UI",Arial'; c.fillStyle = '#fff'; c.fillText(String(idx + 1), x + 12 * sc, yy + 16 * sc);
      c.fillStyle = hex(car.color); c.fillRect(x + 34 * sc, yy + 4 * sc, 5 * sc, rh - 10 * sc);
      c.fillStyle = me ? '#fff' : '#cfd5e2'; c.font = (me ? '800 ' : '600 ') + 13 * sc + 'px "Segoe UI",Arial'; c.fillText(car.name, x + 46 * sc, yy + 16 * sc);
      c.textAlign = 'right'; c.fillStyle = '#9ba3b4'; c.font = '600 ' + 12 * sc + 'px "Consolas",monospace';
      var gap = '';
      if (idx > 0) { var d = leader.race.dist - car.race.dist, vs = Math.max(25, Math.abs(leader.vehicle.speedKmh) / 3.6); gap = d >= S.trackLen * 0.98 ? '+' + Math.floor(d / S.trackLen + 0.02) + 'V' : '+' + (d / vs).toFixed(1); }
      else gap = car.race.finished ? 'FIN' : 'L' + Math.min(S.totalLaps, car.race.lapsDone + 1);
      c.fillText(gap, x + w - 12 * sc, yy + 16 * sc);
      if (!me) { c.fillStyle = '#6f87b8'; c.font = '600 ' + 10.5 * sc + 'px "Consolas",monospace'; c.fillText(Math.round(Math.abs(car.vehicle.speedKmh)) + ' km/h', x + w - 62 * sc, yy + 16 * sc); }
      c.textAlign = 'left';
    }
  };
  UI.prototype._near = function (c, S, x, y, sc) {
    var A = S.near.ahead, B = S.near.behind, pr = S.player.race;
    function line(car, dtm, up, yy) {
      if (!car) return; c.textAlign = 'center'; c.font = '700 ' + 14 * sc + 'px "Segoe UI",Arial'; var tx = (up ? '▲ ' : '▼ ') + car.name + '  ' + (up ? '-' : '+') + Math.abs(dtm).toFixed(1) + ' s';
      var w = c.measureText(tx).width + 28 * sc; c.fillStyle = 'rgba(8,10,16,0.6)'; c.fillRect(x - w / 2, yy - 17 * sc, w, 24 * sc); c.fillStyle = up ? '#7dffa6' : '#ff9a8f'; c.fillText(tx, x, yy); c.textAlign = 'left';
    }
    line(A && A.car, A && A.t, true, y - 30 * sc); line(B && B.car, B && B.t, false, y);
  };
  UI.prototype._lights = function (c, sim, x, y, sc) {
    var w = 300 * sc, h = 64 * sc; c.fillStyle = 'rgba(8,10,16,0.82)'; this._rr(c, x - w / 2, y - h / 2, w, h, 12 * sc); c.fill();
    for (var i = 0; i < 5; i++) {
      var lx = x + (i - 2) * 52 * sc, on = sim.lights > i, go = sim.state !== 'countdown';
      c.beginPath(); c.arc(lx, y, 18 * sc, 0, 6.283); c.fillStyle = go ? '#0f2' : (on ? '#ff1d12' : '#2a0b0b'); c.fill();
      if (on || go) { var g = c.createRadialGradient(lx, y, 0, lx, y, 34 * sc); g.addColorStop(0, go ? 'rgba(80,255,120,.55)' : 'rgba(255,40,20,.55)'); g.addColorStop(1, 'rgba(255,0,0,0)'); c.fillStyle = g; c.fillRect(lx - 34 * sc, y - 34 * sc, 68 * sc, 68 * sc); }
    }
  };
  UI.prototype._messages = function (c, x, y, sc) {
    c.textAlign = 'center';
    for (var i = 0; i < this.msgs.length; i++) {
      var m = this.msgs[i], a = clamp(Math.min(m.life, m.max - m.life + 0.0) * 3, 0, 1), big = m.k === 'big';
      c.globalAlpha = a; c.font = 'italic 800 ' + (big ? 56 : 24) * sc + 'px "Segoe UI",Arial'; var yy = y + (big ? 30 : 0) * sc + i * 34 * sc;
      c.fillStyle = 'rgba(0,0,0,.5)'; c.fillText(m.t, x + 2, yy + 2); c.fillStyle = m.k === 'good' ? '#7dffa6' : (m.k === 'bad' ? '#ff7a6b' : (big ? '#ffffff' : '#ffe27a')); c.fillText(m.t, x, yy);
    }
    c.globalAlpha = 1; c.textAlign = 'left';
  };
  UI.prototype._damage = function (c, car, x, y, sc) {
    var z = car.damageZones, w = 40 * sc, h = 78 * sc;
    c.save(); c.translate(x + w / 2 + 6 * sc, y + h / 2); c.fillStyle = 'rgba(8,10,16,0.55)'; this._rr(c, -w / 2 - 12 * sc, -h / 2 - 8 * sc, w + 24 * sc, h + 16 * sc, 8 * sc); c.fill();
    function col(v) { return v < 0.05 ? 'rgba(160,230,180,0.85)' : 'hsl(' + Math.round(clamp(1 - v * 1.4, 0, 1) * 55) + ',92%,52%)'; }
    c.fillStyle = col(z.front); c.fillRect(-w / 2 + 4 * sc, -h / 2, w - 8 * sc, 18 * sc); c.fillStyle = col(z.rear); c.fillRect(-w / 2 + 4 * sc, h / 2 - 18 * sc, w - 8 * sc, 18 * sc);
    c.fillStyle = col(z.left); c.fillRect(-w / 2, -h / 2 + 22 * sc, 14 * sc, h - 44 * sc); c.fillStyle = col(z.right); c.fillRect(w / 2 - 14 * sc, -h / 2 + 22 * sc, 14 * sc, h - 44 * sc);
    c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(-w / 2 + 16 * sc, -h / 2 + 22 * sc, w - 32 * sc, h - 44 * sc); c.restore();
  };
  UI.prototype._fps = function (c, S) { c.font = '700 13px Consolas,monospace'; c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(this.W / 2 - 78, 4, 156, 20); c.fillStyle = '#9dff9d'; c.textAlign = 'center'; c.fillText(S.fps, this.W / 2, 18); c.textAlign = 'left'; };

  JR.UI = UI;
})();
