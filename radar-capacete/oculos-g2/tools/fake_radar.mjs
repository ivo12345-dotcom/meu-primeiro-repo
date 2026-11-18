// Placa do radar "a fingir": serve a app (dist/) e /data a partir de uma gravação da caixa negra.
//   node tools/fake_radar.mjs <gravacao.txt> [porta=8080] [--cors]
// Converte os alvos em bruto em rumo/distância como o firmware (yaw 0/-120/120), em tempo real.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const [file, portArg, ...flags] = process.argv.slice(2);
const PORT = Number(portArg || 8080);
const CORS = flags.includes('--cors');
const YAW = [0, -120, 120];
const DIST = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'dist');

const recs = [];
for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  const p = l.split(',');
  if (p[0] === 'R') {
    const n = +p[3], pts = [];
    for (let k = 0; k < n; k++) pts.push([+p[4 + 2 * k] / 10, +p[5 + 2 * k] / 10]);
    recs.push({ t: +p[1], r: +p[2], pts });
  } else if (p[0] === 'I') recs.push({ t: +p[1], imu: { h: +p[2], st: +p[3], mv: +p[4], rc: +p[5] } });
}
const t0 = recs[0].t, t1 = recs[recs.length - 1].t, start = Date.now();
console.log(`gravação: ${recs.length} registos, ${((t1 - t0) / 1000).toFixed(0)} s. Porta ${PORT}${CORS ? ' (CORS)' : ''}`);

function stateAt(ms) {
  const tt = t0 + (ms % (t1 - t0));
  const last = [null, null, null]; let imu = { h: 0, st: 1, mv: 0, rc: 0 };
  for (const r of recs) { if (r.t > tt) break; if (r.imu) imu = r.imu; else last[r.r] = r; }
  const tg = [];
  last.forEach((r, i) => { if (!r) return; for (const [x, y] of r.pts) {
    const d = Math.hypot(x, y); if (d < 1) continue;
    tg.push([+(YAW[i] + Math.atan2(x, y) * 180 / Math.PI).toFixed(1), +d.toFixed(2), i]); } });
  return { t: tt, h: imu.h, st: imu.st, cal: 0, imu: 1, mv: imu.mv, rc: imu.rc, rec: 0, rb: 0, mk: 0,
    r: last.map(r => [r ? 1 : 0, 0]), tg };
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (CORS) res.setHeader('Access-Control-Allow-Origin', '*');
  if (u.pathname === '/data') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(stateAt(Date.now() - start)));
  }
  const f = path.join(DIST, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('nao existe'); }
  res.setHeader('Content-Type', f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript');
  fs.createReadStream(f).pipe(res);
}).listen(PORT, '127.0.0.1');
