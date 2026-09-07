// Monitor da VPS (Render) — standby que assume se o PC sumir.
// Roda como processo principal junto com o health server.
// Usa fetch nativo (Node 22) e spawn pra ligar/desligar o bot.
const { spawn } = require('child_process');
const http = require('http');

const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || process.env.PORT || '10000', 10);
const CHECK_SEC = parseInt(process.env.CHECK_INTERVAL_SEC || '15', 10);
const TAKEOVER_SEC = parseInt(process.env.TAKEOVER_AFTER_SEC || '90', 10);
const STEPDOWN_SEC = parseInt(process.env.STEPDOWN_STABLE_SEC || '90', 10);

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ALLOWED = process.env.TELEGRAM_ALLOWED_USER_ID || '';
const OPENCODE_URL = process.env.OPENCODE_API_URL || 'http://localhost:4096';

let botProc = null;
let healthyStreak = 0;

async function tg(text) {
  if (!TOKEN || !ALLOWED) return;
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ALLOWED, text }),
    });
  } catch (e) { console.log('[monitor] falha ao avisar TG:', e.message); }
}

function getStatus() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${HEALTH_PORT}/status`, { timeout: 5000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function setMode(vpsMode) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ vpsMode });
    const req = http.request(`http://localhost:${HEALTH_PORT}/internal/mode`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 5000,
    }, (res) => { res.resume(); res.on('end', () => resolve(true)); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end(body);
  });
}

function botRunning() { return botProc && botProc.exitCode === null; }

function startBot() {
  if (botRunning()) return;
  console.log('[monitor] Assumindo: iniciando bot...');
  botProc = spawn('opencode-telegram', ['start'], { stdio: 'inherit', shell: true, env: { ...process.env, OPENCODE_TELEGRAM_HOME: '/app/data' } });
  botProc.on('exit', (code) => console.log(`[monitor] bot saiu (code=${code})`));
}

function stopBot() {
  return new Promise((resolve) => {
    if (!botRunning()) return resolve(true);
    console.log('[monitor] Devolvendo: parando bot...');
    try {
      // tenta stop gracioso via CLI + mata o filho
      require('child_process').execSync('opencode-telegram stop', { timeout: 8000, stdio: 'ignore' });
    } catch {}
    botProc.kill('SIGTERM');
    const t = setTimeout(() => { try { botProc.kill('SIGKILL'); } catch {} resolve(true); }, 8000);
    botProc.once('exit', () => { clearTimeout(t); resolve(true); });
  });
}

async function tick() {
  const st = await getStatus();
  if (!st) { console.log('[monitor] health local indisponível'); return; }
  const since = st.secondsSinceHeartbeat;
  const isActive = st.vpsMode === 'active';

  if (!isActive) {
    // standby: sumiu heartbeat há TAKEOVER_SEC? assume
    if (since === null) {
      // nunca recebeu heartbeat (PC ainda não configurou VPS_URL) — fica quieto
      return;
    }
    if (since >= TAKEOVER_SEC) {
      if (!st.opencode || !st.opencode.ok) {
        console.log('[monitor] PC sumiu mas OpenCode local da VPS também ruim — aguardo');
        return;
      }
      await setMode('active');
      startBot();
      await tg('⚠️ PC sem sinal há ~90s. Assumi por aqui (modo VPS, arquivos separados da VPS). Quando o PC voltar, devolvo sozinho.');
    }
  } else {
    // active: heartbeat voltou e está fresco há STEPDOWN_SEC? devolve
    if (since !== null && since < CHECK_SEC + 5) {
      healthyStreak += 1;
      console.log(`[monitor] heartbeat fresco (${since}s) streak=${healthyStreak}`);
    } else {
      healthyStreak = 0;
    }
    const need = Math.ceil(STEPDOWN_SEC / CHECK_SEC);
    if (healthyStreak >= need) {
      await stopBot();
      await setMode('standby');
      healthyStreak = 0;
      await tg('✅ PC voltou e está estável. Devolvi o comando — bot da VPS pausado.');
    }
  }
}

console.log(`[monitor] VPS standby. check=${CHECK_SEC}s takeover=${TAKEOVER_SEC}s stepdown=${STEPDOWN_SEC}s`);
setInterval(() => tick().catch((e) => console.log('[monitor] erro:', e.message)), CHECK_SEC * 1000);
