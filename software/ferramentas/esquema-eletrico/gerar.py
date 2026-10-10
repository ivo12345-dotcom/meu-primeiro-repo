# -*- coding: utf-8 -*-
"""Esquema elétrico unifilar do Arlequin (Jeanneau Melody 34) para o eletricista.

Gera `esquema-eletrico-arlequin.svg` na raiz do repositório (A3 deitado, 1587 × 1123 px a 96 dpi) e a tabela de cabos
(`docs/esquema-eletrico-tabela-cabos.md`), com os números do NAVEGACAO §5b/§5c e do §8b ponto 15 (inventário de
08/10/2026). Correr: `python software/ferramentas/esquema-eletrico/gerar.py`; o PDF A3 e a página fazem-se a seguir
(ver docs/esquema-eletrico-eletricista.md e pagina.py).

Topologia desenhada: fontes de carga (MPPT, carregador de cais, VSR) → barramento + do BANCO (antes do corta-corrente,
para carregar com o barco fechado) → fusível principal → corta-corrente de serviço → barramento + de DISTRIBUIÇÃO →
consumidores. Bomba de porão direta do barramento do banco. Guincho e VSR na bateria de arranque.
"""
import io, os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
W, H = 1587, 1123
out = []
def add(s): out.append(s)

CSS = """
<style>
 text { font-family: Arial, Helvetica, sans-serif; fill: #1f1f1f; }
 .tit { font-size: 22px; font-weight: bold; }
 .sub { font-size: 11.5px; fill: #555; }
 .th { font-size: 12.5px; font-weight: bold; }
 .ts { font-size: 10.5px; }
 .tx { font-size: 9.5px; fill: #333; }
 .lab { font-size: 9.5px; fill: #8a1c1c; font-weight: bold; }
 .labn { font-size: 9.5px; fill: #222; font-weight: bold; }
 .pos { stroke: #c0392b; stroke-width: 2.2; fill: none; }
 .posf { stroke: #c0392b; stroke-width: 2.2; fill: none; stroke-dasharray: 7 5; }
 .neg { stroke: #222; stroke-width: 2.2; fill: none; }
 .halo { stroke: #fff; stroke-width: 7; fill: none; }
 .ac { stroke: #7a5a00; stroke-width: 2; fill: none; stroke-dasharray: 3 3; }
 .dc { stroke: #0b6e4f; stroke-width: 2; fill: none; }
 .dados { stroke: #2c5aa0; stroke-width: 1.4; fill: none; stroke-dasharray: 2 3; }
 .caixa { fill: #fff; stroke: #444; stroke-width: 1.2; }
 .fonte { fill: #e8f5ee; stroke: #0b6e4f; stroke-width: 1.4; }
 .bat { fill: #efe9f7; stroke: #5b3f8c; stroke-width: 1.4; }
 .batf { fill: #f7f4fb; stroke: #5b3f8c; stroke-width: 1.4; stroke-dasharray: 6 4; }
 .prot { fill: #fff3e0; stroke: #b36b00; stroke-width: 1.4; }
 .bus { fill: #c0392b; stroke: none; }
 .busn { fill: #222; stroke: none; }
 .carga { fill: #e8eef9; stroke: #2c5aa0; stroke-width: 1.4; }
 .nota { fill: #fffbe6; stroke: #c9a400; stroke-width: 1; }
 .sai { fill: #f3f3f3; stroke: #999; stroke-width: 1; stroke-dasharray: 4 3; }
</style>
"""

def rect(x, y, w, h, cls, rx=6):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" class="{cls}"/>')
def text(x, y, s, cls='ts', anchor='start'):
    s = s.replace('&', '&amp;').replace('<', '&lt;')
    add(f'<text x="{x}" y="{y}" class="{cls}" text-anchor="{anchor}">{s}</text>')
def caixa(x, y, w, h, titulo, linhas=(), cls='caixa'):
    rect(x, y, w, h, cls)
    text(x + w / 2, y + 17, titulo, 'th', 'middle')
    for i, l in enumerate(linhas):
        text(x + 8, y + 33 + i * 13, l, 'tx')
def linha(pts, cls='pos', halo=False):
    d = ' '.join(f'{p[0]},{p[1]}' for p in pts)
    if halo: add(f'<polyline points="{d}" class="halo"/>')
    add(f'<polyline points="{d}" class="{cls}"/>')
def rotulo(x, y, s, cls='lab', anchor='middle'):
    text(x, y, s, cls, anchor)
def fusivel(x, y, s, horizontal=True, lado='dir', baixo=False):
    """Fusível centrado em (x, y); rótulo por cima ou por baixo (horizontal) ou ao lado (vertical: 'dir' ou 'esq')."""
    if horizontal:
        add(f'<rect x="{x-14}" y="{y-6}" width="28" height="12" class="prot" rx="2"/>')
        text(x, y + 19 if baixo else y - 10, s, 'lab', 'middle')
    else:
        add(f'<rect x="{x-6}" y="{y-14}" width="12" height="28" class="prot" rx="2"/>')
        if lado == 'dir': text(x + 10, y + 4, s, 'lab', 'start')
        else: text(x - 10, y + 4, s, 'lab', 'end')
def interruptor(x, y, s, vertical=False, rot_dx=0, rot_dy=16):
    if vertical:
        add(f'<circle cx="{x}" cy="{y-12}" r="3" fill="#222"/><circle cx="{x}" cy="{y+12}" r="3" fill="#222"/>'
            f'<line x1="{x}" y1="{y-10}" x2="{x+11}" y2="{y+9}" stroke="#222" stroke-width="2.2"/>')
    else:
        add(f'<circle cx="{x-12}" cy="{y}" r="3" fill="#222"/><circle cx="{x+12}" cy="{y}" r="3" fill="#222"/>'
            f'<line x1="{x-10}" y1="{y}" x2="{x+9}" y2="{y-11}" stroke="#222" stroke-width="2.2"/>')
    text(x + rot_dx, y + rot_dy, s, 'labn', 'middle' if rot_dx == 0 else 'start')
def ponto(x, y): add(f'<circle cx="{x}" cy="{y}" r="4" fill="#c0392b"/>')

add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">')
add(CSS)
add(f'<rect width="{W}" height="{H}" fill="#fff"/>')
text(30, 36, 'ARLEQUIN (Jeanneau Melody 34) · Esquema elétrico unifilar 12 V CC + 230 V CA · para o eletricista', 'tit')
text(30, 56, 'Versão 1 · 08/10/2026 · decisão do Ivo: serviço = 2 × Tudor TK960 AGM 96 Ah agora, + 4 AGM iguais (576 Ah); arranque = 1 × Tudor TG1101 110 Ah; separador a díodos PF 270 substituído por VSR;', 'sub')
text(30, 71, 'alternador 115 A; 2 × 625 W solar com 2 × MPPT 100/50; SmartShunt no serviço. Comprimentos de cabo a medir a bordo (tabela no caderno). Normas: ISO 10133 (CC), ISO 13297 (CA), ABYC E-11. Lê-se da esquerda para a direita.', 'sub')

# ================= Coluna 1 (x 40–280): painéis, carregador, cais, motor =================
caixa(40, 100, 240, 78, 'Painel solar 1 · Yingli PANDA 3.0 Pro 625 W', ['Voc 55,7 V · Isc 14,3 A · bifacial · no teto do arco', 'cabo solar 6 mm² com fichas MC4 · passa-cabos estanque', 'seccionador CC 2P 32 A antes do MPPT (recomendado)'], 'fonte')
caixa(40, 200, 240, 78, 'Painel solar 2 · Yingli PANDA 3.0 Pro 625 W', ['igual ao painel 1 · NUNCA em série com o 1', '(2 × 55,7 V > 100 V do MPPT) · cada painel no seu MPPT', 'mesmo seccionador e passa-cabos'], 'fonte')
caixa(40, 330, 240, 92, 'Carregador de cais · Navicom Invac Duovolt', ['~30 A · 2 saídas · anos 90 · confirmar perfil AGM na placa', 'saída 1 → barramento + do banco de serviço (fusível 40 A)', 'saída 2 → bateria de arranque (fusível 40 A)', 'a substituir por Blue Smart IP22 12/30 (3) quando houver verba'], 'fonte')
caixa(40, 460, 240, 92, 'Tomada de cais 230 V · 16 A', ['cabo de cais 3G2,5 · tomada estanque', 'disjuntor diferencial 2P 16 A / 30 mA (o branco "N"; confirmar)', 'terra do cais à massa do barco · isolador galvânico (recomendado)', '2–3 tomadas de 230 V a jusante, separadas da tomada do inversor'], 'fonte')
caixa(40, 580, 240, 100, 'Motor Volvo Penta D1-20 · alternador 115 A / 14 V', ['alternador: regulador interno 14,2 V · correia poly-V 6 nervuras', 'B+ → bateria de arranque · cabo 35 mm² · fusível MEGA 150 A', 'D+ fica ligado ao painel MDI (luz de carga), como está', 'motor de arranque + MDI: cabo existente 35–50 mm² (ver terminais)', 'negativo: bloco do motor = massa comum do barco'], 'fonte')

# ================= Coluna 2 (x 360–590): MPPT, VSR, arranque, guincho =================
caixa(360, 100, 230, 78, 'MPPT 1 · Victron SmartSolar 100/50', ['perfil AGM: absorção 14,4 V · flutuação 13,8 V', 'limite de corrente 30 A até as 4 novas entrarem', 'saída 16 mm² · Bluetooth → Pi'], 'carga')
caixa(360, 200, 230, 78, 'MPPT 2 · Victron SmartSolar 100/50', ['mesmas regulações do MPPT 1', 'rede VE.Smart entre os dois e o SmartShunt (sincroniza)', 'saída 16 mm² · Bluetooth → Pi'], 'carga')
caixa(360, 440, 230, 76, 'VSR · Victron Cyrix-ct 12/24-120', ['liga os bancos quando um deles está a carregar', '(> 13,0 V por 2 min) · desliga a < 12,8 V · nos dois sentidos', 'substitui o répartiteur a díodos PF 270 · fio de massa ao barramento −'], 'carga')
caixa(360, 552, 230, 76, 'Bateria de arranque · Tudor TG1101', ['12 V · 110 Ah · 850 A (EN) · ácido livre, de pé, ventilada', 'no compartimento branco, presa com cinta', 'liga só: motor, MDI, guincho, VSR, carregador (saída 2)'], 'bat')
caixa(360, 690, 230, 90, 'Guincho da âncora · Lofrans', ['caixa de relés CB120012 (12 V, 700–1200 W) + motor', 'recetor do comando sem fios "12V" (fusível 5 A)', 'alimentado pela bateria de ARRANQUE', 'cabo 35 mm² (50 mm² se ida+volta > 12 m) · corte ao alcance do leme'], 'carga')

# ================= Coluna 3 (x 680–1010): banco de serviço, barramentos, shunt =================
rect(680, 100, 330, 360, 'bat')
text(845, 118, 'Banco de serviço · AGM · sempre em paralelo', 'th', 'middle')
text(845, 133, 'hoje 2 × 96 Ah = 192 Ah · com as 4 novas 6 × 96 Ah = 576 Ah', 'tx', 'middle')
for i in range(6):
    cx = 695 + (i % 3) * 105; cy = 145 + (i // 3) * 118
    cls = 'bat' if i < 2 else 'batf'
    rect(cx, cy, 95, 100, cls, 4)
    text(cx + 47, cy + 18, f'B{i+1}', 'th', 'middle')
    text(cx + 47, cy + 34, 'Tudor TK960' if i < 2 else 'AGM 96 Ah', 'tx', 'middle')
    text(cx + 47, cy + 47, 'AGM 96 Ah' if i < 2 else 'igual às TK960', 'tx', 'middle')
    text(cx + 47, cy + 60, 'existente' if i < 2 else 'A COMPRAR', 'tx', 'middle')
    text(cx + 47, cy + 80, 'fusível 150 A', 'lab', 'middle')
    text(cx + 47, cy + 92, 'no borne +', 'tx', 'middle')
for i, l in enumerate(['cada bateria com fusível MEGA 150 A no borne + e cabos de', '50 mm² DO MESMO comprimento até aos barramentos; caixa de',
                       'madeira sob o piso (hoje) + 2.ª caixa igual para as 4 novas;', 'cintas, tampas nos bornes, ventilação. ANTES de ligar as 4 novas',
                       'em paralelo: teste das 2 atuais (NAVEGACAO §8b ponto 15)']):
    text(690, 392 + i * 12.5, l, 'tx')

YB = 500   # barramento + do banco
rect(680, YB, 330, 16, 'bus', 3); text(845, YB - 6, 'barramento + do BANCO · 250 A · (cargas ligam aqui: carrega com o barco fechado)', 'labn', 'middle')
fusivel(845, YB + 40, 'fusível principal Class T (ou MEGA) 250 A · cabo 50 mm²')
interruptor(845, YB + 80, 'corta-corrente de serviço ON/OFF 300 A (substitui o seletor branco)')
YD = YB + 125  # barramento + de distribuição
rect(680, YD, 330, 16, 'bus', 3); text(845, YD - 6, 'barramento + de DISTRIBUIÇÃO · 250 A · (consumidores saem daqui)', 'labn', 'middle')
rect(735, 668, 220, 62, 'carga'); text(845, 686, 'Victron SmartShunt 500 A', 'th', 'middle')
text(845, 700, 'no NEGATIVO do serviço: lado "battery" só às baterias;', 'tx', 'middle'); text(845, 712, 'lado "load" a TUDO o resto (cargas, MPPT, carregador, VSR, massa)', 'tx', 'middle')
text(845, 724, 'capacidade 192 Ah (576 com as novas) · Bluetooth → Pi', 'tx', 'middle')
YN = 768  # barramento −
rect(680, YN, 330, 16, 'busn', 3); text(845, YN - 6, 'barramento − de distribuição (massa do serviço) · 250 A', 'labn', 'middle')
text(690, YN + 32, 'massa comum: barramento − ↔ negativo de arranque ↔ bloco do motor (35 mm²)', 'tx')
# banco → barramentos
linha([(845, 460), (845, YB)], 'pos'); rotulo(880, 480, '+ 50 mm²', 'lab', 'start')
linha([(845, YB + 16), (845, YB + 26)], 'pos'); linha([(845, YB + 54), (845, YB + 68)], 'pos'); linha([(845, YB + 92), (845, YD)], 'pos')
linha([(700, 460), (700, 698), (735, 698)], 'neg'); rotulo(706, 562, '− 50 mm²', 'labn', 'start')
linha([(955, 730), (955, YN)], 'neg')

# ================= ligações: fontes → barramento + do banco =================
# painéis → MPPT (CC)
linha([(280, 139), (360, 139)], 'dc'); rotulo(320, 133, '6 mm² MC4')
linha([(280, 239), (360, 239)], 'dc'); rotulo(320, 233, '6 mm² MC4')
# MPPT → barramento do banco (verticais a x = 640 e 630)
linha([(590, 139), (640, 139), (640, YB + 8), (680, YB + 8)], 'pos'); fusivel(612, 139, '63 A · 16 mm²')
linha([(590, 239), (630, 239), (630, YB + 8)], 'pos'); fusivel(610, 239, '63 A · 16 mm²')
# carregador saída 1 → junção na subida do MPPT 2 (x = 630) → barramento do banco
linha([(280, 350), (630, 350)], 'posf'); fusivel(450, 350, '40 A · 10 mm²'); ponto(630, 350)
text(622, 366, 'junção: a saída 1 do carregador junta-se', 'tx', 'end')
text(622, 378, 'ao cabo do MPPT 2 até ao barramento', 'tx', 'end')
# carregador saída 2 → bateria de arranque (x = 335)
linha([(280, 400), (335, 400), (335, 580), (360, 580)], 'posf'); fusivel(335, 490, '40 A', False, 'esq')
# cais 230 V → carregador
linha([(160, 460), (160, 422)], 'ac'); rotulo(170, 445, '230 V · 3G2,5', 'labn', 'start')
# VSR ↔ bateria de arranque e barramento do banco
linha([(475, 516), (475, 552)], 'pos'); fusivel(475, 534, '100 A · 16 mm²', False)
linha([(590, 478), (660, 478), (660, YB + 8), (680, YB + 8)], 'pos'); fusivel(625, 478, '100 A · 16 mm²')
# motor: alternador B+ (y 600) e cabo do motor de arranque com o corta-corrente (y 660 → 615)
linha([(280, 596), (360, 596)], 'pos'); fusivel(340, 596, '150 A · 35 mm²', baixo=True)
linha([(280, 660), (340, 660), (340, 620), (360, 620)], 'pos'); interruptor(300, 660, 'corta-corrente de arranque', rot_dx=-70, rot_dy=28); text(230, 700, '(o de chave vermelha, 300 A) · 35–50 mm²', 'labn')
# guincho ← bateria de arranque
linha([(520, 628), (520, 690)], 'pos'); fusivel(520, 659, 'ANL 100–125 A · 35 mm²', False)
# negativo de arranque → barramento −
linha([(590, 610), (655, 610), (655, YN + 8), (680, YN + 8)], 'neg', halo=True); rotulo(648, 644, '− 35 mm² (bloco do motor)', 'labn', 'end')

# ================= Coluna 4 (x 1090–1550): consumidores =================
caixa(1090, 100, 460, 300, 'Quadro de distribuição 12 V (o existente, revisto)', [
 'alimentação do barramento + de distribuição: 16 mm² · fusível MEGA 100 A (25 mm² + 150 A se > 4 m)',
 'cada circuito com disjuntor ou fusível próprio, cabo estanhado, etiquetado:',
 '• Navegação/Pi: Pi 5 + MacArthur HAT (módulo 12→5 V) · 5 A · ecrã da roda pelo Pi',
 '• Instrumentos: NASA (vento, log, sonda), ST50, ST4000+ (SeaTalk1) · 5 A',
 '• AIS B330 (3 A) · VHF RT750 (10 A) · Navtex · Meshtastic · router 4G (3 A)',
 '• Radar JRC 1000 (10 A) — em pausa, deixar o circuito',
 '• Luzes de navegação LED (5 A) · luzes interiores (10 A) · tomadas USB/12 V (10 A)',
 '• Bomba de água doce (10 A) · frigorífico a compressor (15 A, cabo 4 mm²)',
 '• Piloto EV-100 (ACU-100): disjuntor dedicado 10 A (confirmar no manual) · cabo 2,5 mm²',
 '• Besouros de alarme (1 A) · sensores (ADS1115 gasóleo, barómetro, IMU) pelo Pi',
 '• reserva: 4 circuitos livres',
 'negativo de cada circuito ao barramento − (nunca "massa" pelo casco): o Pi e os instrumentos com o MESMO negativo',
 'medir cada circuito com a pinça depois de pronto e registar no caderno'], 'carga')
caixa(1090, 430, 220, 92, 'Piloto Raymarine EV-100 Wheel', ['ACU-100 no circuito dedicado do quadro (10 A)', 'o ACU-100 alimenta a rede SeaTalkNG (EV-1, p70s)', 'SeaTalkNG ↔ NMEA 2000 do Pi (cabo de ligação)', 'unidade de roda ligada ao ACU-100'], 'carga')
caixa(1330, 430, 220, 92, 'Inversor LTC INV-12600 · 600 W', ['onda modificada · só ferramentas e carregadores simples', 'do barramento + de distribuição: cabo 16 mm², ≤ 2 m', 'fusível ANL 80 A a ≤ 180 mm do barramento', 'tomada 230 V própria, NUNCA ligada à rede do cais'], 'carga')
caixa(1090, 640, 220, 70, 'Bomba de porão + boia', ['direta do barramento + do BANCO (fusível 10 A):', 'funciona com o corta-corrente desligado', 'interruptor manual/auto no quadro'], 'carga')
caixa(1330, 640, 220, 70, 'Dados (azul tracejado)', ['MPPT e SmartShunt → Pi por Bluetooth', 'EV-100 ↔ Pi por NMEA 2000 (SeaTalkNG)', 'motor → Pi por CAN J1939 (cabo em Y do MDI)'], 'caixa')
caixa(1090, 740, 460, 100, 'SAI DO BARCO (retirar, etiquetar, entregar ao Ivo)', [
 '• Separador a díodos Power-first PF 270 (e o módulo com dissipador por cima, se for parte dele)',
 '• 2.ª Tudor Start PRO TG1101 110 Ah · Tudor High-Tech EFB ~100 Ah · Tudor TL652 65 Ah',
 '• seletor branco redondo da caixa das baterias (substituído pelo corta-corrente ON/OFF de 300 A)',
 '• toda a fita isoladora nos terminais; os ramais sem fusível ligados diretamente aos bornes'], 'sai')
# distribuição → quadro (subida a x = 1035)
linha([(1010, YD + 6), (1030, YD + 6), (1030, 130), (1090, 130)], 'pos'); fusivel(1030, 560, 'MEGA 100 A · 16 mm²', False, 'esq')
# quadro → EV-100 (circuito do quadro)
linha([(1200, 400), (1200, 430)], 'pos'); fusivel(1200, 415, '10 A', False)
# distribuição → inversor (y = YD + 12, passa por cima da subida do quadro com halo)
linha([(1010, YD + 12), (1440, YD + 12), (1440, 522)], 'pos', halo=True); fusivel(1280, YD + 12, 'ANL 80 A · 16 mm²')
# banco → bomba de porão (direta, x = 1060, com halo sobre a subida do quadro)
linha([(1010, YB + 8), (1050, YB + 8), (1050, 675), (1090, 675)], 'pos', halo=True); fusivel(1050, 648, '10 A', False, 'esq')
# negativo → quadro
linha([(1010, YN + 8), (1075, YN + 8), (1075, 380), (1090, 380)], 'neg', halo=True); rotulo(1082, 600, '− 16 mm²', 'labn', 'start')
# dados
linha([(475, 178), (475, 200)], 'dados')

# ================= notas =================
rect(40, 880, 620, 125, 'nota')
text(52, 898, 'Regras de execução (ISO 10133 / ABYC E-11)', 'th')
for i, l in enumerate([
 'cores: vermelho = positivo 12 V · preto = negativo · tracejado vermelho = carregador de cais · verde = CC dos painéis',
 '   castanho tracejado = 230 V · azul tracejado = dados',
 'fusível ou disjuntor em TODO o ramal positivo, a ≤ 180 mm (7") da bateria ou do barramento; no máximo 4 terminais por perno',
 'cabo náutico estanhado multifilar, 105 °C; terminais cravados com alicate adequado + manga termorretrátil com cola; etiquetas nas 2 pontas',
 'queda de tensão ≤ 3 % nos circuitos críticos (navegação, piloto, VHF, carga) e ≤ 10 % nos outros (tabela de secções no caderno)',
 'baterias presas com cintas; caixas ventiladas; bornes e barramentos com tampa; as de ácido livre de pé e com os respiros livres',
 'negativo único: barramento − ↔ negativo de arranque ↔ bloco do motor; sem retornos pelo casco; instrumentos com o mesmo negativo do Pi']):
    text(52, 914 + i * 12.5, l, 'tx')
rect(680, 880, 330, 125, 'nota')
text(692, 898, 'Regulações', 'th')
for i, l in enumerate([
 'MPPT (os dois): AGM, absorção 14,4 V, flutuação 13,8 V,',
 '  equalização desligada; corrente máx. 30 A cada enquanto 192 Ah',
 '  (50 A com 576 Ah); temperatura pelo sensor do shunt (VE.Smart)',
 'SmartShunt: 192 Ah (576 depois), carregado a 13,2 V, cauda 4 %,',
 '  Peukert 1,15, eficiência 95 %',
 'Cyrix-ct: automático (liga 13,0 V/2 min, desliga 12,8 V)',
 'carregador de cais: perfil AGM 14,4/13,8 V (confirmar na placa)']):
    text(692, 914 + i * 12.5, l, 'tx')
rect(1090, 880, 460, 125, 'nota')
text(1102, 898, 'Ordem de trabalho sugerida', 'th')
for i, l in enumerate([
 '1. Desligar o cais e os corta-correntes; fotografar e etiquetar tudo antes de desmontar.',
 '2. Retirar as 3 baterias e o PF 270. 3. Barramentos, fusível principal, SmartShunt, corta-corrente',
 '   de serviço; refazer os cabos das 2 TK960 (50 mm², iguais). 4. Cyrix entre arranque e serviço.',
 '5. Guincho e inversor com os seus fusíveis. 6. Quadro: alimentação nova, negativos ao barramento,',
 '   circuitos do Pi e do EV-100. 7. MPPT e painéis. 8. Carregador de cais (saídas e fusíveis).',
 '9. Ensaios de receção (caderno §12) com o Ivo presente; fotografias finais para o registo.']):
    text(1102, 914 + i * 13, l, 'tx')
text(30, H - 14, 'Gerado por software/ferramentas/esquema-eletrico/gerar.py · caderno em docs/esquema-eletrico-eletricista.pdf · fotos do inventário em docs/img-eletrico/ · NAVEGACAO.md §5b, §5c, §8b ponto 15', 'sub')
add('</svg>')
io.open(os.path.join(RAIZ, 'esquema-eletrico-arlequin.svg'), 'w', encoding='utf-8').write('\n'.join(out))

# ================= tabela de cabos (queda de tensão) =================
RHO = 0.0183  # Ω·mm²/m, cobre a 20 °C
AMPAC = {2.5: 30, 4: 40, 6: 55, 10: 75, 16: 120, 25: 160, 35: 210, 50: 285, 70: 330}  # A, ABYC E-11, 105 °C, fora do compartimento do motor
CIRC = [
 ('Bateria ↔ barramentos (cada bateria)', 150, 50, 3),
 ('Alternador → bateria de arranque', 115, 35, 3),
 ('Cyrix ↔ bancos', 100, 16, 3),
 ('MPPT → barramento + do banco', 50, 16, 3),
 ('Painel → MPPT (CC, 14 A a 46 V)', 14, 6, 3),
 ('Barramento → quadro', 60, 16, 3),
 ('Guincho da âncora (1000 W)', 90, 35, 10),
 ('Inversor 600 W', 55, 16, 3),
 ('Carregador de cais → bancos (30 A)', 30, 10, 3),
 ('EV-100 ACU-100', 5, 2.5, 3),
 ('Pi 5 + HAT', 3, 2.5, 3),
 ('Frigorífico', 8, 4, 3),
 ('VHF', 6, 2.5, 3),
]
md = ['| Circuito | Corrente de cálculo | Secção proposta | Capacidade do cabo | Queda admitida | Comprimento máx. (ida, só o positivo) |', '|---|---|---|---|---|---|']
for nome, i, sec, pct in CIRC:
    dv = 12.7 * pct / 100
    lmax = sec * dv / (2 * i * RHO)
    md.append(f'| {nome} | {i} A | {sec} mm² | {AMPAC[sec]} A | {pct} % ({dv:.2f} V) | {lmax:.1f} m |')
md.append('')
md.append('Fórmula: comprimento máximo (m) = secção (mm²) × queda admitida (V) ÷ (2 × corrente (A) × 0,0183 Ω·mm²/m). O "2 ×" conta o positivo e o negativo (ida e volta); "comprimento" é só a ida. Se o percurso medido for maior do que o máximo, sobe-se uma secção. Capacidade de corrente: ABYC E-11, cabo de 105 °C fora do compartimento do motor; dentro dele multiplica-se por 0,85.')
io.open(os.path.join(RAIZ, 'docs', 'esquema-eletrico-tabela-cabos.md'), 'w', encoding='utf-8').write('\n'.join(md) + '\n')
print('esquema-eletrico-arlequin.svg e docs/esquema-eletrico-tabela-cabos.md gravados')
