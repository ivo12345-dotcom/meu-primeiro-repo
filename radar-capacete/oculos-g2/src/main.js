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

let blink = false;
function aviso(x, y) {  // triângulo de aviso com "!"
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(x, y - 20); ctx.lineTo(x - 20, y + 15); ctx.lineTo(x + 20, y + 15); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#000'; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('!', x, y + 12);
}

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
  // aviso RCWL (movimento atrás de parede, só com a cabeça parada): fatia tracejada para o lado do RCWL
  // Pisca (uma imagem sim, outra não) e põe um triângulo de aviso "!" na borda, do lado do RCWL.
  if (d.rc && d.st && d.ry !== undefined) {
    blink = !blink;
    const a0 = (d.ry - 45 - 90) * Math.PI / 180, a1 = (d.ry + 45 - 90) * Math.PI / 180;
    ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = blink ? '#fff' : '#555'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1); ctx.closePath(); ctx.stroke(); ctx.restore();
    if (blink) aviso(cx + Math.sin(d.ry * Math.PI / 180) * (R - 30), cy - Math.cos(d.ry * Math.PI / 180) * (R - 30));
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

// Esconder/mostrar SÓ pelo telemóvel (o Ivo não quer tocar nos óculos de luvas):
// botão 👓 na página do radar (fica guardado na placa, "g2" no /data) ou o botão desta página.
let hidden = false, sentBlank = false;
async function toggle() {
  try { await fetch(RADAR + '/cmd?c=g2_toggle', { cache: 'no-store' }); } catch (e) { log('botão falhou:', e && e.message); }
}

let lastText = null;
async function push(d) {
  hidden = !!d && d.g2 === 0;
  const btn = document.getElementById('bG2');
  if (btn) btn.textContent = hidden ? 'MOSTRAR RADAR NOS ÓCULOS' : 'ESCONDER RADAR DOS ÓCULOS';
  if (hidden) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);  // tudo preto = lente transparente
    if (sentBlank) return;                              // já está apagado: não gastar Bluetooth
  } else draw(d);
  if (!bridge) return;
  sentBlank = hidden;
  const r1 = await bridge.updateImageRawData({ containerID: 1, containerName: 'radar-cima', imageData: gray8(0, 144) });
  const r2 = await bridge.updateImageRawData({ containerID: 2, containerName: 'radar-baixo', imageData: gray8(144, 144) });
  if (!ImageRawDataUpdateResult.isSuccess(r1) || !ImageRawDataUpdateResult.isSuccess(r2)) log('imagem falhou:', r1, r2);
  const n = d ? (d.tg || []).length : 0;
  let txt;
  if (hidden) txt = ' ';
  else if (!d) txt = 'SEM\nRADAR';
  else {
    const mortos = (d.r || []).map((r, i) => (r[0] ? '' : NAMES[i])).filter(Boolean);
    txt = (n ? n + (n === 1 ? ' ALVO' : ' ALVOS') : '') +
      (!d.st ? '\nmexer' : '') +   // aviso do RCWL: só o triângulo "!" no radar, sem texto
(mortos.length ? '\n-- ' + mortos.join(' ') : '');
  }
  if (!txt) txt = ' ';   // texto vazio não é aceite: um espaço apaga o "A ligar..."
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
  const b = document.getElementById('bG2'); if (b) b.onclick = toggle;
  try { await setupGlasses(); } catch (e) { log('sem óculos (só pré-visualização):', e && e.message); }
  poll();
})();
