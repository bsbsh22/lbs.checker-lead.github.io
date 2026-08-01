/**
 * LittleBigSnake - Server discovery + status checker
 * Implements:
 *  Master: wss://master.littlebigsnake.com:8443/
 *    send 4 binary messages (hex)
 *    await tag 0xAF = 175
 *    parse server list (BE)
 *  Game servers: wss://<url>:<port>
 *    send 000E050000000000002C00000000 (original working, spec says 000A0500000000000021)
 *    await tag 6, parse from offset 6608 top10 players
 */

const MASTER_URL = 'wss://master.littlebigsnake.com:8443/';
const MASTER_MESSAGES_HEX = [
  "0023642c05010000000000176261424c4d56414b6f5576333543793434646262376663",
  "0003ae"
];
// For game server - protocol tag 5 request
const GAME_CHECK_HEX_PRIMARY = "000E050000000000002C00000000"; // from C# working code
const GAME_CHECK_HEX_FALLBACK = "000A0500000000000021"; // from task description

const els = {
  btnStart: document.getElementById('btn-start'),
  startScreen: document.getElementById('start-screen'),
  masterStatus: document.getElementById('master-status'),
  serversSection: document.getElementById('servers-section'),
  serversGrid: document.getElementById('servers'),
  btnCheckAll: document.getElementById('btn-check-all'),
  btnPc: document.getElementById('btn-pc'),
  btnMobile: document.getElementById('btn-mobile'),
  platformToggle: document.getElementById('platform-toggle'),
  scannerPanel: document.getElementById('scanner-panel'),
  scannerInput: document.getElementById('scanner-input'),
  btnScan: document.getElementById('btn-scan')
};

// Current platform: 'pc' or 'mobile'
let currentPlatform = 'pc';

/**
 * Returns the correct port for a server based on platform.
 * Moscow is inverted: PC=9002, Mobile=9001
 * All others: PC=9001, Mobile=9002
 */
function getPortForServer(server, platform) {
  const isMoscow = server.url.includes('moscow') || server.name.toLowerCase().includes('moscow');
  if (isMoscow) {
    return platform === 'pc' ? 9002 : 9001;
  }
  return platform === 'pc' ? 9001 : 9002;
}

/** Apply current platform ports to all discovered servers and update card labels */
function applyPlatform(platform) {
  currentPlatform = platform;
  discoveredServers.forEach(s => {
    s.port = getPortForServer(s, platform);
  });
  // Update toggle button states
  els.btnPc.classList.toggle('active', platform === 'pc');
  els.btnMobile.classList.toggle('active', platform === 'mobile');
  // Update toggle button labels
  els.btnPc.textContent = platform === 'pc' ? 'ПК (9001)' : 'ПК';
  els.btnMobile.textContent = platform === 'mobile' ? 'Мобильные (9002)' : 'Мобильные';
  // Update port display on each card
  const cards = Array.from(document.querySelectorAll('.server-card'));
  cards.forEach((card, i) => {
    if (!discoveredServers[i]) return;
    const portEl = card.querySelector('.server-port');
    if (portEl) portEl.textContent = '🔌 ' + discoveredServers[i].port;
  });
}

function hexToBytes(hex) {
  hex = hex.replace(/\s+/g, '');
  const len = hex.length / 2;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    arr[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return arr;
}
function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function logMaster(msg, cls='info') {
  els.masterStatus.innerHTML = `<span class="${cls}">${msg}</span>`;
  console.log('[master]', msg);
}

let discoveredServers = [];
let discoveredServers_ts = JSON.parse('[{"name":"eu_Moscow","url":"moscow.littlebigsnake.com","port":9001},{"name":"eu_Stockholm","url":"stockholm.littlebigsnake.com","port":9001},{"name":"eu_Frankfurt","url":"frankfurt.littlebigsnake.com","port":9001},{"name":"eu_Amsterdam","url":"amsterdam.littlebigsnake.com","port":9001},{"name":"eu_Paris","url":"paris.littlebigsnake.com","port":9001},{"name":"eu_London","url":"london.littlebigsnake.com","port":9001},{"name":"as_TelAviv","url":"tel-aviv.littlebigsnake.com","port":9001},{"name":"eu_Madrid","url":"madrid.littlebigsnake.com","port":9001},{"name":"as_Bahrain","url":"bahrain.littlebigsnake.com","port":9001},{"name":"as_Delhi","url":"delhi.littlebigsnake.com","port":9001},{"name":"as_Mumbai","url":"mumbai.littlebigsnake.com","port":9001},{"name":"as_Seoul","url":"seoul.littlebigsnake.com","port":9001},{"name":"as_HongKong","url":"hong-kong.littlebigsnake.com","port":9001},{"name":"as_Tokyo","url":"tokyo.littlebigsnake.com","port":9001},{"name":"na_NewYork","url":"new-york.littlebigsnake.com","port":9001},{"name":"na_Toronto","url":"toronto.littlebigsnake.com","port":9001},{"name":"na_Chicago","url":"chicago.littlebigsnake.com","port":9001},{"name":"na_Seattle","url":"seattle.littlebigsnake.com","port":9001},{"name":"as_Singapore","url":"singapore.littlebigsnake.com","port":9001},{"name":"af_Johannesburg","url":"johannesburg.littlebigsnake.com","port":9001},{"name":"na_Dallas","url":"dallas.littlebigsnake.com","port":9001},{"name":"na_Miami","url":"miami.littlebigsnake.com","port":9001},{"name":"na_LosAngeles","url":"los-angeles.littlebigsnake.com","port":9001},{"name":"sa_SaoPaulo","url":"sao-paulo.littlebigsnake.com","port":9001},{"name":"sa_Santiago","url":"santiago.littlebigsnake.com","port":9001},{"name":"au_Sydney","url":"sydney.littlebigsnake.com","port":9001}]');

/** Master discovery */
async function discoverServers() {
  return new Promise((resolve, reject) => {
    let ws; let af1=true;
    try {
      ws = new WebSocket(MASTER_URL);
    } catch (e) {
      reject(e);
      return;
    }
    ws.binaryType = 'arraybuffer';
    let timeout = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('Таймаут мастера (10с)'));
    }, 10000);

    ws.onopen = () => {
      logMaster('Соединение с мастер-сервером установлено, отправляем запросы...', 'info');
      // Send 4 messages sequentially with tiny delay
      try {
         ws.send(hexToBytes(MASTER_MESSAGES_HEX[0]));
        
        logMaster('Запрос списка серверов отправлен (1 пакет), ждем ответ AF...', 'info');
      } catch (e) {
        clearTimeout(timeout);
        reject(e);
      }
    };

    ws.onmessage = (ev) => {
      const buf = ev.data;
      if (!(buf instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(buf);
      if (bytes.length < 3) return;
      const size = (bytes[0] << 8) | bytes[1]; // BE, informational
      const tag = bytes[2];
      // console.log('master msg', tag, bytes.length, size, bytesToHex(bytes.slice(0,32)));
      if (tag === 0xAF) { // 175
        clearTimeout(timeout);
        try {
          const servers = parseMasterAF(buf);
          ws.close();
          resolve(servers);
        } catch (e) {
          reject(e);
        }
      };
      if(af1){ws.send(hexToBytes(MASTER_MESSAGES_HEX[1]));af1=false;}
    };

    ws.onerror = (e) => {
      clearTimeout(timeout);
      reject(new Error('Ошибка WebSocket мастера'));
    };
    ws.onclose = (e) => {
      // If not resolved and no AF yet, will be caught by timeout; if closed after resolve, ignore
    };
  });
}

function parseMasterAF(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length < 4) throw new Error('AF сообщение слишком короткое');
  const tag = bytes[2];
  if (tag !== 0xAF) throw new Error('Неверный тег, ожидается AF');
  let offset = 3;
  const count = bytes[offset];
  offset += 1;
  const servers = [];
  const decoder = new TextDecoder('utf-8');
  for (let i = 0; i < count; i++) {
    if (offset + 2 > bytes.length) break;
    const nameLen = view.getUint16(offset, false);
    offset += 2;
    if (offset + nameLen > bytes.length) break;
    const name = decoder.decode(bytes.slice(offset, offset + nameLen));
    offset += nameLen;

    if (offset + 2 > bytes.length) break;
    const urlLen = view.getUint16(offset, false);
    offset += 2;
    if (offset + urlLen > bytes.length) break;
    const url = decoder.decode(bytes.slice(offset, offset + urlLen));
    offset += urlLen;

    if (offset + 2 > bytes.length) break;
    view.getUint16(offset, false);
    const port = 9001;
    
    offset += 2;

    servers.push({ name: name.trim(), url: url.trim(), port });
  }
  if (servers.length === 0) throw new Error('Не удалось распарсить список серверов, получено 0');
  return servers;
}

/** Game server check */
function parseLeaderboard(buffer) {
  const totalBytes = new Uint8Array(buffer);
  const LEADERBOARD_OFFSET = 6608;
  if (totalBytes.length <= LEADERBOARD_OFFSET) {
    return { players: [], hasData: false, note: `Сообщение короткое (${totalBytes.length} байт), лидерборда нет` };
  }
  const slice = totalBytes.slice(LEADERBOARD_OFFSET);
  const view = new DataView(slice.buffer, slice.byteOffset, slice.byteLength);
  const decoder = new TextDecoder('utf-8');
  let cur = 0;
  const players = [];
  try {
    for (let i = 0; i < 10; i++) {
      if (cur + 3 >= slice.length) break;
      const hz0 = view.getUint8(cur); cur++;
      const pos = view.getUint8(cur); cur++;
      const hz1 = view.getUint8(cur); cur++;
      if (cur >= slice.length) break;
      const nameLen = view.getUint8(cur); cur++;
      if (cur + nameLen > slice.length) break;
      const name = decoder.decode(slice.subarray(cur, cur + nameLen));
      cur += nameLen;
      if (cur + 4 > slice.length) break;
      const mass = view.getUint32(cur, false);
      cur += 4;
      if (cur + 2 > slice.length) break;
      const hz2_0 = view.getUint8(cur);
      const hz2_1 = view.getUint8(cur + 1);
      cur += 2;
      if (cur >= slice.length) break;
      const mateg = view.getUint8(cur); cur++;
      let badge = '';
      let badgeClass = '';
      if (mateg === 4 || mateg === 5 || mateg === 3) { badge = '💀'; badgeClass = 'bang'; }
      else if (mateg === 1) { badge = 'top'; badgeClass = 'top'; }
      if (cur + 4 > slice.length) break;
      const id = view.getUint32(cur, false);
      cur += 4;
      if (cur + 2 > slice.length) break;
      const hz3 = view.getUint16(cur, false);
      cur += 2;

      players.push({
        rank: pos,
        name: name.trim().slice(0, 32),
        mass,
        badge,
        badgeClass,
        id,
        debug: { hz0, hz1, hz2: [hz2_0, hz2_1], mateg, hz3 }
      });
    }
  } catch (e) {
    console.warn('parse leaderboard error', e);
  }
  return { players, hasData: players.length > 0, note: players.length ? '' : 'Не удалось распарсить топ' };
}

function checkSingleServer(server, cardEl) {
  return new Promise((resolve) => {
    const { url, port, name } = server;
    const target = `wss://${url}:${port}`;
    let ws;
    const startMark = performance.now();
    let ping = null;
    let finished = false;
    let collectTimer = null;
    let gotTag6 = false;
    let lastLb = null;
    let lastPing = null;
    let packetLog = [];  // Debug: log all received packets

    const setStatus = (state, msg) => {
      if (!cardEl) return;
      cardEl.classList.remove('online','offline','checking');
      cardEl.classList.add(state);
      const badge = cardEl.querySelector('.server-badge');
      if (badge) {
        badge.textContent = msg;
        badge.className = 'server-badge ' + (state==='online'?'badge-online': state==='offline'?'badge-offline':'badge-checking');
      }
    };

    const updateBody = (html) => {
      if (!cardEl) return;
      const body = cardEl.querySelector('.server-body');
      if (body) body.innerHTML = html;
    };

    const finish = (result) => {
      if (finished) return;
      finished = true;
      if (collectTimer) clearTimeout(collectTimer);
      try { if (ws && ws.readyState === 1) ws.close(); } catch {}
      resolve(result);
    };

    // Scan packet for potential player count values
    // Based on IL2CPP reverse engineering: ChangeMySnakeData has place(uint16) + numPlaces(uint16)
    // numPlaces = total players in arena
    const scanForPlayerCount = (bytes) => {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const len = bytes.length;
      // Small packets (< 100 bytes): look for place/numPlaces pattern (high weight)
      if (len < 100 && len > 10) {
        // Try uint16 BE pairs: place followed by numPlaces
        for (let i = 3; i <= len - 4; i++) {
          const place = view.getUint16(i, false);
          const numPlaces = view.getUint16(i + 2, false);
          if (place >= 1 && place <= 200 && numPlaces >= 5 && numPlaces <= 200 && place <= numPlaces && numPlaces !== 10) {
            playerCountCandidates[numPlaces] = (playerCountCandidates[numPlaces] || 0) + 5;
          }
        }
        // Try varint (byte pairs): place + numPlaces as single bytes
        for (let i = 3; i <= len - 2; i++) {
          const place = bytes[i];
          const numPlaces = bytes[i + 1];
          if (place >= 1 && place <= 127 && numPlaces >= 5 && numPlaces <= 127 && place <= numPlaces && numPlaces !== 10) {
            playerCountCandidates[numPlaces] = (playerCountCandidates[numPlaces] || 0) + 3;
          }
        }
      }
      // All packets: scan uint16 BE in typical player count range (low weight)
      for (let i = 3; i <= len - 2; i++) {
        const val = view.getUint16(i, false);
        if (val >= 15 && val <= 80 && val !== 10) {
          playerCountCandidates[val] = (playerCountCandidates[val] || 0) + 1;
        }
      }
    };

    // Rebuild card body with player count
    const updateWithPlayerCount = () => {
      const sorted = Object.entries(playerCountCandidates).sort((a, b) => b[1] - a[1]);
      const pc = sorted.length > 0 && sorted[0][1] >= 2 ? parseInt(sorted[0][0]) : null;
      if (!lastLb || lastPing === null) return;
      const pingClass = lastPing < 120 ? 'fast' : lastPing < 300 ? 'mid' : 'slow';
      let html = `<div>Пинг: <span class="ping ${pingClass}">${Math.round(lastPing)} ms</span></div>`;
      if (pc !== null) {
        html += `<div class="player-count">👥 Игроков: <b>${pc}</b></div>`;
      }
      if (lastLb.hasData && lastLb.players.length) {
        html += `<div class="leaderboard"><div class="leaderboard-title">Топ 10 игроков</div>`;
        lastLb.players.forEach(p => {
          const massStr = p.mass.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
          const big = p.mass > 1000000 ? ' 🍖' : '';
          html += `<div class="player-row">
            <div class="player-pos">${p.rank}</div>
            <div class="player-name" title="${p.name} (${p.id})">${p.name}</div>
            <div class="player-mass">${massStr}${big}</div>
            <div class="player-extra ${p.badgeClass}">${p.badge || ''}</div>
          </div>`;
        });
        html += `</div>`;
        if (lastLb.players.some(x=>x.mass>1000000)) {
          html += `<div style="margin-top:6px;color:#8eff8e;font-size:11px;">⚡ Обнаружен большой змей >1M!</div>`;
        }
      } else {
        html += `<div class="raw-dump">${lastLb.note || 'Нет данных топа'}</div>`;
      }
      updateBody(html);
    };

    const overallTimeout = setTimeout(() => {
      setStatus('offline', 'таймаут');
      updateBody(`<div class="raw-dump">Не отвечает >6с<br>${target}</div>`);
      finish({ server, ok: false, error: 'timeout' });
    }, 7000);

    try {
      ws = new WebSocket(target);
    } catch (e) {
      clearTimeout(overallTimeout);
      setStatus('offline', 'ошибка URL');
      updateBody(`<div class="raw-dump">${e.message}</div>`);
      finish({ server, ok: false, error: e.message });
      return;
    }

    ws.binaryType = 'arraybuffer';
    setStatus('checking', 'проверка...');

    ws.onopen = () => {
      const sendBytes = hexToBytes(GAME_CHECK_HEX_PRIMARY);
      try {
        ws.send(sendBytes);
        // store send time for ping
        server._sendTime = performance.now();
      } catch (e) {
        clearTimeout(overallTimeout);
        setStatus('offline', 'send fail');
        finish({ server, ok: false, error: e.message });
      }
    };

    ws.onmessage = (ev) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(ev.data);
      if (bytes.length < 3) return;
      const tag = bytes[2];

      // DEBUG: логируем каждый пакет в консоль
      const hex = bytesToHex(bytes.slice(0, 64));
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      // uint16 BE на смещениях 0x1C и 0x1E (place + numPlaces из ChangeMySnakeData)
      const u16_1C = bytes.length > 0x1D ? dv.getUint16(0x1C, false) : -1;
      const u16_1E = bytes.length > 0x1F ? dv.getUint16(0x1E, false) : -1;
      console.log(
        `[${name}] tag=${tag} len=${bytes.length} | hex[0..63]: ${hex}`,
        `\n  u16@0x1C(place)=${u16_1C}  u16@0x1E(numPlaces)=${u16_1E}`,
        bytes.length <= 80 ? bytes : ''
      );

      // Scan EVERY packet for player count candidates
      scanForPlayerCount(bytes);

      if (tag !== 6) return;

      if (ping === null) {
        ping = performance.now() - (server._sendTime || startMark);
      }
      const lb = parseLeaderboard(ev.data);
      lastLb = lb;
      lastPing = ping;
      gotTag6 = true;

      const pingClass = ping < 120 ? 'fast' : ping < 300 ? 'mid' : 'slow';
      let html = `<div>Пинг: <span class="ping ${pingClass}">${Math.round(ping)} ms</span></div>`;
      html += `<div class="player-count scanning">👥 Игроков: <b>...</b></div>`;

      if (lb.hasData && lb.players.length) {
        html += `<div class="leaderboard"><div class="leaderboard-title">Топ 10 игроков</div>`;
        lb.players.forEach(p => {
          const massStr = p.mass.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
          const big = p.mass > 1000000 ? ' 🍖' : '';
          html += `<div class="player-row">
            <div class="player-pos">${p.rank}</div>
            <div class="player-name" title="${p.name} (${p.id})">${p.name}</div>
            <div class="player-mass">${massStr}${big}</div>
            <div class="player-extra ${p.badgeClass}">${p.badge || ''}</div>
          </div>`;
        });
        html += `</div>`;
        if (lb.players.some(x=>x.mass>1000000)) {
          html += `<div style="margin-top:6px;color:#8eff8e;font-size:11px;">⚡ Обнаружен большой змей >1M!</div>`;
        }
      } else {
        html += `<div class="raw-dump">${lb.note || 'Нет данных топа'}<br>Дамп начала: ${bytesToHex(bytes.slice(0, 48))}...</div>`;
      }

      setStatus('online', `онлайн ${Math.round(ping)}ms`);
      updateBody(html);
      clearTimeout(overallTimeout);

      // Keep socket open 3s to collect more packets for player count
      if (collectTimer) clearTimeout(collectTimer);
      collectTimer = setTimeout(() => {
        updateWithPlayerCount();
        finish({ server, ok: true, ping, players: lb.players, rawLen: bytes.length });
      }, 3000);
    };

    ws.onerror = () => {
      // will trigger onclose too
      if (!finished) {
        setStatus('offline', 'ошибка');
        updateBody(`<div class="raw-dump">WebSocket error<br>${target}</div>`);
      }
    };
    ws.onclose = () => {
      if (!finished) {
        // if we never got tag 6, treat as offline unless we already finished
        clearTimeout(overallTimeout);
        if (ping === null) {
          setStatus('offline', 'закрыто');
          // leave body as is if already set, else set offline
          const body = cardEl?.querySelector('.server-body');
          if (body && body.textContent.trim() === '' || body?.innerHTML.includes('проверка')) {
            updateBody(`<div class="raw-dump">Соединение закрылось без данных (тег 6 не получен)<br>${target}</div>`);
          }
          finish({ server, ok: false, error: 'closed without data' });
        } else {
          if (gotTag6) updateWithPlayerCount();
          finish({ server, ok: true });
        }
      }
    };
  });
}

function createServerCard(server) {
  const card = document.createElement('div');
  card.className = 'server-card checking';
  card.dataset.url = server.url;
  card.dataset.port = server.port;
  card.innerHTML = `
    <div class="server-header">
      <div class="server-title">${escapeHtml(server.name)}</div>
      <div class="server-badge badge-checking">ожидание</div>
    </div>
    <div class="server-meta">
      <span>🌐 ${escapeHtml(server.url)}</span>
      <span class="server-port">🔌 ${server.port}</span>
       
    </div>
    <div class="server-body"><em>Не проверен</em></div>
    <button class="btn-check-single">Проверить</button>
  `;
  const btn = card.querySelector('.btn-check-single');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Проверяю...';
    await checkSingleServer(server, card);
    btn.disabled = false;
    btn.textContent = 'Проверить снова';
  });
  return card;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

async function renderServers(servers) {
  discoveredServers = servers;
  applyPlatform(currentPlatform);
  els.serversGrid.innerHTML = '';
  servers.forEach(s => {
    const card = createServerCard(s);
    els.serversGrid.appendChild(card);
  });
  els.startScreen.hidden = true;
  els.serversSection.hidden = false;
  els.btnStart.style.display = 'none';
  logMaster(`Найдено серверов: ${servers.length}`, 'ok');
  els.startScreen.remove();
  // Auto check? no, wait for user to press "проверить все"
}

async function checkAllServers() {
  if (!discoveredServers.length) return;
  els.btnCheckAll.disabled = true;
  els.btnCheckAll.textContent = 'проверяю...';
  const cards = Array.from(document.querySelectorAll('.server-card'));
  const concurrency = 5;
  let idx = 0;

  async function worker() {
    while (idx < discoveredServers.length) {
      const currentIdx = idx++;
      const server = discoveredServers[currentIdx];
      const card = cards[currentIdx];
      const btn = card?.querySelector('.btn-check-single');
      if (btn) { btn.disabled = true; }
      await checkSingleServer(server, card);
      if (btn) { btn.disabled = false; btn.textContent = 'Проверить снова'; }
      // small delay to be polite
      await new Promise(r => setTimeout(r, 200));
    }
  }

  const workers = Array.from({length: Math.min(concurrency, discoveredServers.length)}, () => worker());
  await Promise.all(workers);

  els.btnCheckAll.disabled = false;
  els.btnCheckAll.textContent = 'проверить все сервера';
}

function mockServersForDemo() {
  return [
    { name: 'Amsterdam', url: 'amsterdam.littlebigsnake.com', port: 9001 },
    { name: 'Frankfurt', url: 'frankfurt.littlebigsnake.com', port: 9001 },
    { name: 'London', url: 'london.littlebigsnake.com', port: 9001 },
    { name: 'Paris', url: 'paris.littlebigsnake.com', port: 9001 },
    { name: 'Moscow', url: 'moscow.littlebigsnake.com', port: 9001 },
  ];
}

/* ============ PlayerScanner Module ============ */
/**
 * Scans all game servers in parallel batches to find a target player by accountId.
 * Workflow:
 *   1. Connect to each server via WebSocket (wss://<url>:<port>)
 *   2. Send observer probe: 000E050000000000002C00000000
 *   3. Parse tag 6 leaderboard (offset 6608), check each player.id === targetId
 *   4. If not in top-10, keep socket open 2s listening for tick tags (0x0C / 0x08),
 *      scan raw bytes for target ID as BE uint32
 *   5. On match: highlight card, show server/rank/mass, "Observe" button
 */
const PlayerScanner = {
  _active: false,
  _abort: false,
  _sockets: [],

  /** Stop all scanning */
  stop() {
    this._abort = true;
    this._active = false;
    this._sockets.forEach(ws => { try { ws.close(); } catch {} });
    this._sockets = [];
  },

  /** Main entry: scan all discovered servers for targetId */
  async scan(targetId) {
    if (this._active) return;
    const id = parseInt(targetId, 10);
    if (isNaN(id) || id <= 0) {
      ScannerUI.status('Неверный ID игрока', 'scan-error');
      return;
    }

    this._active = true;
    this._abort = false;
    this._sockets = [];
    ScannerUI.clearResults();
    ScannerUI.showStop();

    const servers = [...discoveredServers];
    const cards = Array.from(document.querySelectorAll('.server-card'));
    const concurrency = 7;
    let idx = 0;
    let scanned = 0;
    let foundCount = 0;
    const total = servers.length;

    ScannerUI.status(`Сканирование ${total} серверов... (ID: ${id})`, 'scan-info');
    ScannerUI.progress(0, total);

    async function worker() {
      while (idx < servers.length && !PlayerScanner._abort) {
        const currentIdx = idx++;
        const server = servers[currentIdx];
        const card = cards[currentIdx];
        if (card) card.classList.add('scanning-target');

        const result = await PlayerScanner._probeServer(server, id, card);

        scanned++;
        if (card) card.classList.remove('scanning-target');
        ScannerUI.progress(scanned, total);

        if (result.found) {
          foundCount++;
          ScannerUI.addResult(server, result, id);
          if (card) card.classList.add('target-found');
        }
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
    await Promise.all(workers);

    // Clean up any remaining sockets
    this._sockets.forEach(ws => { try { ws.close(); } catch {} });
    this._sockets = [];
    this._active = false;
    ScannerUI.hideStop();

    if (this._abort) {
      ScannerUI.status(`Сканирование остановлено. Проверено ${scanned}/${total}, найдено ${foundCount}.`, 'scan-partial');
    } else if (foundCount === 0) {
      ScannerUI.status(`Готово! Проверено ${total} серверов. Игрок ${id} не найден.`, 'scan-error');
    } else {
      ScannerUI.status(`Готово! Проверено ${total} серверов. Игрок найден на ${foundCount} сервер(ах).`, 'scan-done');
    }
  },

  /**
   * Probe a single server for the target ID.
   * Returns { found, server, rank, mass, name, ping, method }
   */
  _probeServer(server, targetId, cardEl) {
    return new Promise((resolve) => {
      const { url, port, name } = server;
      const target = `wss://${url}:${port}`;
      let ws;
      let resolved = false;
      let ping = null;
      let sendTime = null;
      let gotTag6 = false;
      let tickTimer = null;

      const done = (result) => {
        if (resolved) return;
        resolved = true;
        if (tickTimer) clearTimeout(tickTimer);
        try { if (ws && ws.readyState === 1) ws.close(); } catch {}
        resolve(result);
      };

      const timeout = setTimeout(() => {
        done({ found: false });
      }, 10000);

      try {
        ws = new WebSocket(target);
      } catch {
        clearTimeout(timeout);
        done({ found: false });
        return;
      }
      this._sockets.push(ws);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        try {
          ws.send(hexToBytes(GAME_CHECK_HEX_PRIMARY));
          sendTime = performance.now();
        } catch {
          clearTimeout(timeout);
          done({ found: false });
        }
      };

      ws.onmessage = (ev) => {
        if (!(ev.data instanceof ArrayBuffer)) return;
        const bytes = new Uint8Array(ev.data);
        if (bytes.length < 3) return;
        const tag = bytes[2];

        // Tag 6 = state/leaderboard
        if (tag === 6) {
          if (ping === null) ping = performance.now() - (sendTime || performance.now());
          gotTag6 = true;
          const lb = parseLeaderboard(ev.data);

          // 1) Check if target is in the parsed top-10 leaderboard
          if (lb.hasData) {
            const match = lb.players.find(p => p.id === targetId);
            if (match) {
              clearTimeout(timeout);
              done({
                found: true,
                server,
                rank: match.rank,
                mass: match.mass,
                name: match.name,
                ping: Math.round(ping),
                method: 'leaderboard'
              });
              return;
            }
          }

          // 2) Scan the ENTIRE tag 6 buffer for target ID — there may be
          //    more player data beyond the parsed top-10
          if (PlayerScanner._scanBytesForId(bytes, targetId, 3)) {
            clearTimeout(timeout);
            done({
              found: true,
              server,
              rank: null,
              mass: null,
              name: '(в игре, вне топ-10)',
              ping: ping ? Math.round(ping) : null,
              method: 'tag6-fullscan'
            });
            return;
          }

          // 3) Not found in tag 6: extend timeout to listen for tick packets
          //    Reset the main timeout and set a tick-listening window of 5s
          clearTimeout(timeout);
          tickTimer = setTimeout(() => {
            done({ found: false });
          }, 5000);
          return;
        }

        // 4) After tag 6, scan ALL incoming packets for target ID
        //    (arena ticks 0x0C/0x08, updates, entity spawns, etc.)
        if (gotTag6) {
          if (PlayerScanner._scanBytesForId(bytes, targetId, 3)) {
            if (ping === null) ping = performance.now() - (sendTime || performance.now());
            if (tickTimer) clearTimeout(tickTimer);
            done({
              found: true,
              server,
              rank: null,
              mass: null,
              name: '(в игре, вне топ-10)',
              ping: ping ? Math.round(ping) : null,
              method: 'tick-scan'
            });
            return;
          }
        }
      };

      ws.onerror = () => {
        done({ found: false });
      };

      ws.onclose = () => {
        done({ found: false });
      };
    });
  },

  /**
   * Scan raw byte buffer for a target ID encoded as BE uint32.
   * Scans every 4-byte-aligned and non-aligned position from offset `start`.
   */
  _scanBytesForId(bytes, targetId, start = 0) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const len = bytes.length;
    for (let i = start; i <= len - 4; i++) {
      try {
        if (view.getUint32(i, false) === targetId) return true;
      } catch {}
    }
    return false;
  }
};

/** Scanner UI helpers */
const ScannerUI = {
  statusEl: null,
  resultsEl: null,
  init() {
    this.statusEl = document.getElementById('scanner-status');
    this.resultsEl = document.getElementById('scanner-results');
  },
  status(msg, cls = 'scan-info') {
    if (!this.statusEl) return;
    this.statusEl.innerHTML = `<span class="${cls}">${msg}</span>`;
  },
  progress(done, total) {
    if (!this.statusEl) return;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const existing = this.statusEl.querySelector('.scan-info, .scan-partial');
    const msg = existing ? existing.textContent : `Сканирование... ${done}/${total}`;
    this.statusEl.innerHTML = `<span class="scan-info">${msg}</span><div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>`;
  },
  clearResults() {
    if (this.resultsEl) this.resultsEl.innerHTML = '';
    // Remove old highlights
    document.querySelectorAll('.server-card.target-found').forEach(c => c.classList.remove('target-found'));
  },
  addResult(server, result, targetId) {
    if (!this.resultsEl) return;
    const massStr = result.mass !== null
      ? result.mass.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
      : '?';
    const rankStr = result.rank !== null ? `#${result.rank}` : 'вне топа';
    const pingStr = result.ping !== null ? `${result.ping} ms` : '?';
    const card = document.createElement('div');
    card.className = 'target-found-card';
    card.innerHTML = `
      <div>
        <div class="tfc-label">✅ Игрок найден!</div>
        <div class="tfc-server">${escapeHtml(server.name)}</div>
      </div>
      <div class="tfc-detail">ID: <b>${targetId}</b></div>
      <div class="tfc-detail">Ник: <b>${escapeHtml(result.name || '?')}</b></div>
      <div class="tfc-detail">Позиция: <b>${rankStr}</b></div>
      <div class="tfc-detail">Масса: <b>${massStr}</b></div>
      <div class="tfc-detail">Пинг: <b>${pingStr}</b></div>
      <div class="tfc-detail">Метод: <b>${result.method}</b></div>
    `;
    this.resultsEl.appendChild(card);
  },
  showStop() {
    const btn = document.getElementById('btn-scan');
    const btnStop = document.getElementById('btn-scan-stop');
    if (btn) btn.hidden = true;
    if (btnStop) btnStop.hidden = false;
  },
  hideStop() {
    const btn = document.getElementById('btn-scan');
    const btnStop = document.getElementById('btn-scan-stop');
    if (btn) btn.hidden = false;
    if (btnStop) btnStop.hidden = true;
  }
};

/* Event bindings */
els.btnStart.addEventListener('click', async () => {
  els.btnStart.disabled = true;
  els.btnStart.textContent = 'ИЩУ...';
  logMaster('Подключаюсь к мастеру '+MASTER_URL, 'info');
  try {
    //const servers = await discoverServers();
    //logMaster(`Успех! Получено ${servers.length} серверов`, 'ok');
    //setTimeout(() => renderServers(servers), 400);
    renderServers(discoveredServers_ts);
  } catch (e) {
    console.error(e);
    logMaster(`Ошибка: ${e.message}<br><small>Попробуйте еще раз. Возможно мастер недоступен или блокирует wss из браузера (CORS). Для теста можно показать демо-сервера ниже.</small><br><button id="demo" style="margin-top:8px;padding:6px 12px;border-radius:8px;border:1px solid #fff;background:rgba(255,255,255,0.15);color:#fff;cursor:pointer;">Показать демо список</button>`, 'err');
    // hook demo button
    setTimeout(() => {
      const demoBtn = document.getElementById('demo');
      if (true) demoBtn.onclick = () => renderServers(discoveredServers_ts);
    }, 100);
  } finally {
    els.btnStart.disabled = false;
    els.btnStart.textContent = 'НАЧАТЬ';
  }
});

els.btnCheckAll.addEventListener('click', () => {
  checkAllServers();
});

els.btnPc.addEventListener('click', () => {
  if (currentPlatform === 'pc') return;
  applyPlatform('pc');
});

els.btnMobile.addEventListener('click', () => {
  if (currentPlatform === 'mobile') return;
  applyPlatform('mobile');
});

// Initialize Scanner UI
ScannerUI.init();

// Scanner event bindings
const btnScan = document.getElementById('btn-scan');
const btnScanStop = document.getElementById('btn-scan-stop');
const scannerInput = document.getElementById('scanner-input');

btnScan.addEventListener('click', () => {
  const id = scannerInput.value.trim();
  if (!id) {
    ScannerUI.status('Введите ID игрока!', 'scan-error');
    return;
  }
  PlayerScanner.scan(id);
});

btnScanStop.addEventListener('click', () => {
  PlayerScanner.stop();
});

scannerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnScan.click();
});

// Easter: if URL has ?auto, start automatically
if (new URLSearchParams(location.search).has('auto')) {
  els.btnStart.click();
}
