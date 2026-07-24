/**
 * LittleBigSnake - Server discovery + status checker
 * Implements:
 *  Master: wss://master.littlebigsnake.com:8443/
 *    send 4 binary messages (hex)
 *    await tag 0xAF = 175
 *    parse server list (BE)
 *  Game servers: wss://<url>:<port>
 *    send 000E050000000000002C00000000 (original working, spec says 000A0500000000000021)
 *    await tag 6, parse from offset 6608 top3 players
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
  btnCheckAll: document.getElementById('btn-check-all')
};

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
    const port = view.getUint16(offset, false);
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
    for (let i = 0; i < 3; i++) {
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
      if (mateg === 4 || mateg === 5 || mateg === 3) { badge = '!!!'; badgeClass = 'bang'; }
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
      try { if (ws && ws.readyState === 1) ws.close(); } catch {}
      resolve(result);
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
      if (tag !== 6) {
        // ignore other tags
        return;
      }
      if (ping === null) {
        ping = performance.now() - (server._sendTime || startMark);
      }
      const lb = parseLeaderboard(ev.data);

      const pingClass = ping < 120 ? 'fast' : ping < 300 ? 'mid' : 'slow';
      let html = `<div>Пинг: <span class="ping ${pingClass}">${Math.round(ping)} ms</span> | Размер ответа: ${bytes.length} байт</div>`;

      if (lb.hasData && lb.players.length) {
        html += `<div class="leaderboard"><div class="leaderboard-title">Топ 3 игрока</div>`;
        lb.players.forEach(p => {
          const massStr = p.mass.toString();
          const big = p.mass > 1000000 ? ' 🔥' : '';
          html += `<div class="player-row">
            <div class="player-pos">${p.rank}</div>
            <div class="player-name" title="${p.name} (${p.id})">${p.name}</div>
            <div class="player-mass">${massStr}${big}</div>
            <div class="player-extra ${p.badgeClass}">${p.badge || ''} #${p.id}</div>
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
      // close after a little
      setTimeout(() => { try{ ws.close(); }catch{} }, 300);
      finish({ server, ok: true, ping, players: lb.players, rawLen: bytes.length });
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
      <span>🔌 ${server.port}</span>
      <span>wss://${escapeHtml(server.url)}:${server.port}</span>
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

/* Event bindings */
els.btnStart.addEventListener('click', async () => {
  els.btnStart.disabled = true;
  els.btnStart.textContent = 'ИЩУ...';
  logMaster('Подключаюсь к мастеру '+MASTER_URL, 'info');
  try {
    const servers = await discoverServers();
    logMaster(`Успех! Получено ${servers.length} серверов`, 'ok');
    setTimeout(() => renderServers(servers), 400);
  } catch (e) {
    console.error(e);
    logMaster(`Ошибка: ${e.message}<br><small>Попробуйте еще раз. Возможно мастер недоступен или блокирует wss из браузера (CORS). Для теста можно показать демо-сервера ниже.</small><br><button id="demo" style="margin-top:8px;padding:6px 12px;border-radius:8px;border:1px solid #fff;background:rgba(255,255,255,0.15);color:#fff;cursor:pointer;">Показать демо список</button>`, 'err');
    // hook demo button
    setTimeout(() => {
      const demoBtn = document.getElementById('demo');
      if (demoBtn) demoBtn.onclick = () => renderServers(mockServersForDemo());
    }, 100);
  } finally {
    els.btnStart.disabled = false;
    els.btnStart.textContent = 'НАЧАТЬ';
  }
});

els.btnCheckAll.addEventListener('click', () => {
  checkAllServers();
});

// Easter: if URL has ?auto, start automatically
if (new URLSearchParams(location.search).has('auto')) {
  els.btnStart.click();
}
