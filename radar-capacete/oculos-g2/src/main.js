// Radar de capacete nos óculos Even Realities G2.
// Corre dentro da app Even (no telemóvel). Lê /data da placa do radar e desenha nos óculos:
//   esquerda: radar 288x288 (2 imagens de 288x144, o máximo por imagem)
//   direita : texto com o número de alvos e o estado
// A placa é http://192.168.4.1 (rede RADAR-CAPACETE). Se a página vier da própria placa, usa o mesmo sítio.
import {
  waitForEvenAppBridge,
  StartUpPageCreateResult,
  ImageRawDataUpdateResult,
} from '@evenrealities/even_hub_sdk';

const W = 288, H = 288;          // radar
const RANGE_M = 6;               // alcance mostrado
const FPS_MS = 400;              // imagem nova a cada 0,4 s (Bluetooth é lento)
const params = new URLSearchParams(location.search);
// ?radar=  (vazio) = mesmo sítio da página; ?radar=http://x = outro sítio; sem nada = a placa
const RADAR = params.has('radar') ? params.get('radar')
  : (location.hostname === '192.168.4.1' ? '' : 'http://192.168.4.1');
const NAMES = ['FRENTE', 'T-ESQ', 'T-DIR'];

const log = (...a) => { console.log('[radar]', ...a); const el = document.getElementById('log'); if (el) el.textContent = a.join(' ') + '\n' + el.textContent.slice(0, 2000); };

// ---------- desenho (canvas cinzento -> bytes Gray8) ----------
const cv = document.createElement('canvas');
cv.width = W; cv.height = H;
const ctx = cv.getContext('2d', { willReadFrequently: true });

function draw(d) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2, R = W / 2 - 6, sc = R / RANGE_M;
  ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
  for (let m = 2; m <= RANGE_M; m += 2) { ctx.beginPath(); ctx.arc(cx, cy, m * sc, 0, Math.PI * 2); ctx.stroke(); }
  ctx.strokeStyle = '#333';
  for (let a = 0; a < 360; a += 60) {
    const r = a * Math.PI / 180;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(r) * R, cy - Math.cos(r) * R); ctx.stroke();
  }
  // seta da frente e "tu"
  ctx.fillStyle = '#aaa';
  ctx.beginPath(); ctx.moveTo(cx, 2); ctx.lineTo(cx - 6, 12); ctx.lineTo(cx + 6, 12); ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
  if (!d) {
    ctx.fillStyle = '#fff'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('SEM LIGAÇÃO', cx, cy + 8);
    return;
  }
  // alvos: [rumo°, distância m, radar]; a página do telemóvel compensa a rotação da cabeça com d.h
  const h = d.h || 0;
  for (const t of d.tg || []) {
    const b = (t[0] - h) * Math.PI / 180, dist = Math.min(t[1], RANGE_M);
    const x = cx + Math.sin(b) * dist * sc, y = cy - Math.cos(b) * dist * sc;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.stroke();
  }
}

function gray8(y0, h) {
  const px = ctx.getImageData(0, y0, W, h).data;
  const out = new Array(W * h);
  for (let i = 0; i < W * h; i++) out[i] = px[i * 4];  // canal vermelho = cinzento
  return out;
}

// ---------- óculos ----------
let bridge = null;
async function setupGlasses() {
  bridge = await waitForEvenAppBridge();
  const img = (id, name, y) => ({ xPosition: 0, yPosition: y, width: W, height: 144, containerID: id, containerName: name, zOrderIndex: id });
  const res = await bridge.createStartUpPageContainer({
    containerTotalNum: 3,
    imageObject: [img(1, 'radar-cima', 0), img(2, 'radar-baixo', 144)],
    // tudo do lado ESQUERDO: o texto fica no canto de cima do próprio radar, a metade direita fica vazia
    textObject: [{
      xPosition: 0, yPosition: 0, width: 120, height: 70, containerID: 3, containerName: 'estado',
      zOrderIndex: 3, content: 'A ligar...', isEventCapture: 1,
    }],
  });
  log('página criada:', res);
  return res === StartUpPageCreateResult.success;
}

let lastText = '';
async function push(d) {
  draw(d);
  if (!bridge) return;
  const r1 = await bridge.updateImageRawData({ containerID: 1, containerName: 'radar-cima', imageData: gray8(0, 144) });
  const r2 = await bridge.updateImageRawData({ containerID: 2, containerName: 'radar-baixo', imageData: gray8(144, 144) });
  if (!ImageRawDataUpdateResult.isSuccess(r1) || !ImageRawDataUpdateResult.isSuccess(r2)) log('imagem falhou:', r1, r2);
  const n = d ? (d.tg || []).length : 0;
  let txt;
  if (!d) txt = 'SEM\nRADAR';
  else {
    const mortos = (d.r || []).map((r, i) => (r[0] ? '' : NAMES[i])).filter(Boolean);
    txt = (n ? n + (n === 1 ? ' ALVO' : ' ALVOS') : '') +
      (!d.st ? '\nmexer' : (d.rc ? '\nPAREDE!' : '')) + (mortos.length ? '\n-- ' + mortos.join(' ') : '');
  }
  if (txt !== lastText) {
    lastText = txt;
    await bridge.textContainerUpgrade({ containerID: 3, containerName: 'estado', content: txt });
  }
}

// ---------- ciclo ----------
async function poll() {
  let d = null;
  try {
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 1500);
    const r = await fetch(RADAR + '/data', { signal: ac.signal, cache: 'no-store' });
    clearTimeout(to);
    d = await r.json();
  } catch (e) { log('fetch falhou:', e && e.message); }
  try { await push(d); } catch (e) { log('push falhou:', e && e.message); }
  setTimeout(poll, FPS_MS);
}

(async () => {
  log('radar em', RADAR || location.origin);
  document.body.appendChild(cv);  // pré-visualização na página do telemóvel
  try { await setupGlasses(); } catch (e) { log('sem óculos (só pré-visualização):', e && e.message); }
  poll();
})();
