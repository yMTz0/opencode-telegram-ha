// Health + failover server — funciona no PC (porta 4097) e na VPS Render (porta $PORT)
// Sem dependências externas (só Node built-in). ROLE=pc | vps
const http = require('http');
const { execSync } = require('child_process');

const ROLE = process.env.ROLE || 'pc';
const PORT = parseInt(process.env.HEALTH_PORT || process.env.PORT || (ROLE === 'pc' ? '4097' : '10000'), 10);
const OPENCODE_URL = process.env.OPENCODE_API_URL || 'http://localhost:4096';

// Estado em memória (VPS usa pra guardar último heartbeat do PC)
const state = {
  role: ROLE,
  startedAt: new Date().toISOString(),
  // VPS: modo standby|active (active = assumiu porque PC sumiu)
  vpsMode: 'standby',
  lastHeartbeatAt: null,
  lastHeartbeatBody: null,
  takeovers: 0,
  lastTakeoverAt: null,
  lastStepdownAt: null,
};

function checkOpencode() {
  return new Promise((resolve) => {
    const req = http.get(`${OPENCODE_URL}/global/health`, { timeout: 4000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode, body: d.slice(0, 200) }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

function checkBot() {
  // Tenta `opencode-telegram status` — se disser running, bot ok
  try {
    const out = execSync('opencode-telegram status', { timeout: 8000, encoding: 'utf8', windowsHide: true });
    return { ok: /running/i.test(out), raw: out.split('\n').slice(0, 4).join(' | ').slice(0, 200) };
  } catch (e) {
    return { ok: false, error: (e.message || '').slice(0, 200) };
  }
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  // GET = JSON cheio. HEAD = só 200 (UptimeRobot checa com HEAD).
  if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/health' || url.pathname === '/status')) {
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end();
      return;
    }
    const [oc, bot] = await Promise.all([checkOpencode(), checkBot()]);
    return json(res, 200, {
      role: state.role,
      ok: oc.ok,
      opencode: oc,
      bot,
      vpsMode: state.vpsMode,
      lastHeartbeatAt: state.lastHeartbeatAt,
      secondsSinceHeartbeat: state.lastHeartbeatAt ? Math.round((Date.now() - Date.parse(state.lastHeartbeatAt)) / 1000) : null,
      takeovers: state.takeovers,
      startedAt: state.startedAt,
      now: new Date().toISOString(),
    });
  }

  // PC manda POST aqui a cada 30s
  if (req.method === 'POST' && url.pathname === '/heartbeat') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      try {
        const j = JSON.parse(body || '{}');
        state.lastHeartbeatAt = new Date().toISOString();
        state.lastHeartbeatBody = { opencodeOk: !!j.opencodeOk, botOk: !!j.botOk, pcMode: j.pcMode || 'primary', at: j.at || null };
        return json(res, 200, { ok: true, vpsMode: state.vpsMode, receivedAt: state.lastHeartbeatAt });
      } catch {
        return json(res, 400, { ok: false, error: 'invalid json' });
      }
    });
    return;
  }

  // Monitor da VPS atualiza o modo (standby|active) por aqui — só localhost
  if (req.method === 'POST' && url.pathname === '/internal/mode') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1024) req.destroy(); });
    req.on('end', () => {
      try {
        const j = JSON.parse(body || '{}');
        if (j.vpsMode === 'standby' || j.vpsMode === 'active') {
          if (j.vpsMode === 'active' && state.vpsMode !== 'active') {
            state.takeovers += 1;
            state.lastTakeoverAt = new Date().toISOString();
          }
          if (j.vpsMode === 'standby' && state.vpsMode !== 'standby') {
            state.lastStepdownAt = new Date().toISOString();
          }
          state.vpsMode = j.vpsMode;
        }
        return json(res, 200, { ok: true, vpsMode: state.vpsMode });
      } catch {
        return json(res, 400, { ok: false });
      }
    });
    return;
  }

  return json(res, 404, { ok: false, error: 'not found' });
});

const HOST = process.env.HOST || (ROLE === 'pc' ? '127.0.0.1' : '0.0.0.0');
server.listen(PORT, HOST, () => console.log(`[ha-server] role=${ROLE} ouvindo em ${HOST}:${PORT}`));
