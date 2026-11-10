# -*- coding: utf-8 -*-
"""Acompanhamento da depressão CHARLES (11/11/2026) para o Arlequin: avisos do IPMA, trajetória do centro
em dois modelos (ECMWF e GFS, Open-Meteo), vento/pressão/mar na costa e ao largo, e simulações de
"se fôssemos apanhados": três posições de partida × cinco táticas, com a previsão interpolada na posição
do barco hora a hora.

python charles.py [--pasta-dados PASTA] [--sem-descarregar]

Os dados brutos ficam na pasta de dados (por omissão, a pasta scratch desta sessão): avisos do IPMA,
grelhas de 0,5° (vento, rajada, direção, pressão) por modelo, grelha de mar de 1°, e séries em pontos
fixos. Cada corrida com descarga guarda uma cópia datada dos dados e escreve o boletim em
docs/tempestades/2026-11-11-charles/ (HTML com as figuras embebidas + PDF pelo Chrome).
"""
import io, os, sys, json, gzip, math, time, base64, datetime, subprocess, urllib.request
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SAIDA = os.path.join(RAIZ, 'docs', 'tempestades', '2026-11-11-charles')
PASTA = None
for i, a in enumerate(sys.argv):
    if a == '--pasta-dados': PASTA = sys.argv[i + 1]
if PASTA is None:
    PASTA = os.environ.get('CHARLES_DADOS', os.path.dirname(os.path.abspath(__file__)))
DESCARREGAR = '--sem-descarregar' not in sys.argv
os.makedirs(SAIDA, exist_ok=True); os.makedirs(PASTA, exist_ok=True)
AGORA = datetime.datetime.now(datetime.timezone.utc)
CARIMBO = AGORA.strftime('%Y-%m-%dT%H%MZ')

MODELOS_GRELHA = ['ecmwf_ifs025', 'gfs_seamless']
MODELOS_PONTO = 'ecmwf_ifs025,gfs_seamless,icon_seamless,meteofrance_seamless,ukmo_seamless'
PONTOS = {'cascais_largo': (38.65, -9.60), 'barra_tejo': (38.67, -9.33), 'espichel': (38.40, -9.30),
          'sines': (37.93, -8.95), 'berlengas': (39.40, -9.55), 'largo_60MN': (38.60, -10.90)}
LATS = [33 + 0.5 * i for i in range(17)]; LONS = [-17 + 0.5 * i for i in range(23)]
LATS_MAR = [33 + i for i in range(9)]; LONS_MAR = [-17 + i for i in range(12)]
NOMES_AREA = {'LSB': 'Lisboa', 'STB': 'Setúbal', 'STM': 'Santarém', 'LRA': 'Leiria', 'PTG': 'Portalegre', 'EVR': 'Évora', 'BJA': 'Beja', 'FAR': 'Faro',
              'CBO': 'Castelo Branco', 'CBR': 'Coimbra', 'AVR': 'Aveiro', 'VIS': 'Viseu', 'GDA': 'Guarda', 'PTO': 'Porto', 'BRG': 'Braga',
              'VCT': 'Viana do Castelo', 'VRL': 'Vila Real', 'BGC': 'Bragança', 'MCN': 'Madeira (costa norte)', 'MCS': 'Madeira (costa sul)',
              'MRM': 'Madeira (montanha)', 'MPS': 'Porto Santo'}

# ---------------------------------------------------------------- descarga com cache e paciência
def pedir(url, tent=6):
    for k in range(tent):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return json.loads(r.read().decode('utf-8'))
        except Exception as e:
            print('  espera', k, str(e)[:70]); time.sleep(20 + 10 * k)
    raise SystemExit('Open-Meteo/IPMA não respondeu: ' + url[:80])

def grelha_url(bloco, modelo):
    return ('https://api.open-meteo.com/v1/forecast?latitude=' + ','.join(str(p[0]) for p in bloco) + '&longitude=' + ','.join(str(p[1]) for p in bloco)
            + '&hourly=pressure_msl,wind_speed_10m,wind_gusts_10m,wind_direction_10m&wind_speed_unit=kn&timezone=UTC&forecast_days=3&models=' + modelo)

def descarregar():
    print('IPMA avisos'); av = pedir('https://api.ipma.pt/open-data/forecast/warnings/warnings_www.json')
    io.open(os.path.join(PASTA, 'ipma_avisos.json'), 'w', encoding='utf-8').write(json.dumps(av))
    print('IPMA observações'); io.open(os.path.join(PASTA, 'ipma_estacoes.json'), 'w', encoding='utf-8').write(json.dumps(pedir('https://api.ipma.pt/open-data/observation/meteorology/stations/stations.json')))
    io.open(os.path.join(PASTA, 'ipma_obs.json'), 'w', encoding='utf-8').write(json.dumps(pedir('https://api.ipma.pt/open-data/observation/meteorology/stations/observations.json')))
    pts = [(la, lo) for la in LATS for lo in LONS]
    for modelo in MODELOS_GRELHA:
        print('grelha', modelo); out = []
        for k in range(0, len(pts), 60):
            d = pedir(grelha_url(pts[k:k + 60], modelo)); out.extend(d if isinstance(d, list) else [d]); time.sleep(3)
        io.open(os.path.join(PASTA, f'om_grelha_fina_{modelo}.json'), 'w', encoding='utf-8').write(json.dumps(out))
    print('grelha mar'); pts_mar = [(la, lo) for la in LATS_MAR for lo in LONS_MAR]; out = []
    for k in range(0, len(pts_mar), 60):
        b = pts_mar[k:k + 60]
        url = ('https://marine-api.open-meteo.com/v1/marine?latitude=' + ','.join(str(p[0]) for p in b) + '&longitude=' + ','.join(str(p[1]) for p in b)
               + '&hourly=wave_height,wave_period,wave_direction&timezone=UTC&forecast_days=3&cell_selection=sea')
        d = pedir(url); out.extend(d if isinstance(d, list) else [d]); time.sleep(3)
    io.open(os.path.join(PASTA, 'om_grelha_mar.json'), 'w', encoding='utf-8').write(json.dumps(out))
    print('pontos'); res = {}
    for nome, (la, lo) in PONTOS.items():
        u1 = f'https://api.open-meteo.com/v1/forecast?latitude={la}&longitude={lo}&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl,precipitation&wind_speed_unit=kn&timezone=UTC&forecast_days=3&models={MODELOS_PONTO}'
        u2 = f'https://marine-api.open-meteo.com/v1/marine?latitude={la}&longitude={lo}&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period&timezone=UTC&forecast_days=3&cell_selection=sea'
        res[nome] = {'lat': la, 'lon': lo, 'atm': pedir(u1), 'mar': pedir(u2)}; time.sleep(2)
    io.open(os.path.join(PASTA, 'om_pontos.json'), 'w', encoding='utf-8').write(json.dumps(res))
    # cópia datada
    hist = os.path.join(PASTA, 'historico'); os.makedirs(hist, exist_ok=True)
    for f in ('ipma_avisos.json', 'ipma_obs.json', 'om_pontos.json', 'om_grelha_mar.json') + tuple(f'om_grelha_fina_{m}.json' for m in MODELOS_GRELHA):
        io.open(os.path.join(hist, CARIMBO + '-' + f), 'w', encoding='utf-8').write(io.open(os.path.join(PASTA, f), encoding='utf-8').read())

if DESCARREGAR:
    descarregar()

def ler(nome):
    return json.load(io.open(os.path.join(PASTA, nome), encoding='utf-8'))

AVISOS = ler('ipma_avisos.json'); PONTOS_DADOS = ler('om_pontos.json'); MAR = ler('om_grelha_mar.json')
OBS = ler('ipma_obs.json') if os.path.exists(os.path.join(PASTA, 'ipma_obs.json')) else {}
ESTACOES = {'1210765': 'Cabo Raso', '1200531': 'Cabo Carvoeiro', '1200535': 'Lisboa (Geofísico)', '1210770': 'Setúbal', '1200541': 'Sines', '1200533': 'Sagres'}
DIR_IPMA = {0: '—', 1: 'N', 2: 'NE', 3: 'E', 4: 'SE', 5: 'S', 6: 'SW', 7: 'W', 8: 'NW', 9: 'N'}
def obs_serie(idx):
    out = []
    for h in sorted(OBS):
        o = OBS[h].get(idx)
        if not o: out.append((h, None, None, None, None)); continue
        v = o.get('intensidadeVentoKM'); p = o.get('pressao'); d = o.get('idDireccVento'); r = o.get('precAcumulada')
        out.append((h, None if v is None or v < 0 else v / 1.852, None if p is None or p < 0 else p, d, None if r is None or r < 0 else r))
    return out
GRELHAS = {m: ler(f'om_grelha_fina_{m}.json') for m in MODELOS_GRELHA}
HORAS = GRELHAS['ecmwf_ifs025'][0]['hourly']['time']  # UTC = hora de Lisboa em novembro
PRIMEIRA_HORA = AGORA.replace(minute=0, second=0, microsecond=0).strftime('%Y-%m-%dT%H:%M')
HORA_DADOS = (PONTOS_DADOS['cascais_largo']['atm'].get('generationtime_ms') and CARIMBO) or CARIMBO

# ---------------------------------------------------------------- campos em grelha + interpolação
import numpy as np

class Campo:
    """Grelha regular (lat, lon) × horas de uma variável, com interpolação bilinear; None → nan."""
    def __init__(self, pontos, lats, lons, var):
        self.lats = np.array(lats); self.lons = np.array(lons); self.t = pontos[0]['hourly']['time']
        self.v = np.full((len(lats), len(lons), len(self.t)), np.nan)
        for p in pontos:
            i = int(np.argmin(np.abs(self.lats - p['latitude']))); j = int(np.argmin(np.abs(self.lons - p['longitude'])))
            self.v[i, j, :] = [np.nan if x is None else x for x in p['hourly'][var]]
    def em(self, lat, lon, ih):
        la = self.lats; lo = self.lons
        if lat < la[0] or lat > la[-1] or lon < lo[0] or lon > lo[-1]: return float('nan')
        i = min(int((lat - la[0]) / (la[1] - la[0])), len(la) - 2); j = min(int((lon - lo[0]) / (lo[1] - lo[0])), len(lo) - 2)
        fi = (lat - la[i]) / (la[1] - la[0]); fj = (lon - lo[j]) / (lo[1] - lo[0])
        q = self.v[i:i + 2, j:j + 2, ih]
        if np.isnan(q).any():  # perto da costa (mar) ou falha: o vizinho válido mais próximo
            cand = [(abs(fi - a) + abs(fj - b), q[a, b]) for a in (0, 1) for b in (0, 1) if not np.isnan(q[a, b])]
            return min(cand)[1] if cand else float('nan')
        return float((1 - fi) * (1 - fj) * q[0, 0] + (1 - fi) * fj * q[0, 1] + fi * (1 - fj) * q[1, 0] + fi * fj * q[1, 1])

def campo_dir(pontos, lats, lons, var):  # direção: interpolar pelas componentes
    cs = Campo(pontos, lats, lons, var); sn = Campo(pontos, lats, lons, var)
    cs.v = np.cos(np.radians(cs.v)); sn.v = np.sin(np.radians(sn.v))
    class D:
        def em(self, lat, lon, ih):
            c = cs.em(lat, lon, ih); s = sn.em(lat, lon, ih)
            return float('nan') if math.isnan(c) else (math.degrees(math.atan2(s, c)) % 360)
    return D()

CAMPOS = {}
for m, g in GRELHAS.items():
    CAMPOS[m] = {'p': Campo(g, LATS, LONS, 'pressure_msl'), 'v': Campo(g, LATS, LONS, 'wind_speed_10m'),
                 'r': Campo(g, LATS, LONS, 'wind_gusts_10m'), 'd': campo_dir(g, LATS, LONS, 'wind_direction_10m')}
MAR_HS = Campo(MAR, LATS_MAR, LONS_MAR, 'wave_height'); MAR_TP = Campo(MAR, LATS_MAR, LONS_MAR, 'wave_period'); MAR_DIR = campo_dir(MAR, LATS_MAR, LONS_MAR, 'wave_direction')

def ih_de(t):
    return HORAS.index(t)

# ---------------------------------------------------------------- trajetória do centro
def trajetoria(modelo):
    """Centro = mínimo de pressão na caixa 33–40,5 N / 17–6 W, com continuidade: a partir da hora em que
    um mínimo fechado aparece a sul de 38 N (a Charles vem do sul da Madeira), segue-se o mínimo mais
    próximo do centro anterior entre os candidatos a menos de 1,5 hPa do mínimo absoluto."""
    c = CAMPOS[modelo]['p']; traj = []; anterior = None
    for ih, t in enumerate(HORAS):
        sub = c.v[:16, :, ih]  # lat ≤ 40,5
        if np.isnan(sub).all(): continue
        pmin = np.nanmin(sub)
        cand = [(c.lats[i], c.lons[j], sub[i, j]) for i in range(sub.shape[0]) for j in range(sub.shape[1]) if sub[i, j] <= pmin + 1.5]
        if anterior is None:
            sul = [x for x in cand if x[0] <= 38.5]
            if not sul or pmin > 998: continue
            esc = min(sul, key=lambda x: x[2])
        else:
            esc = min(cand, key=lambda x: (x[0] - anterior[0]) ** 2 + (x[1] - anterior[1]) ** 2)
            if math.hypot(esc[0] - anterior[0], esc[1] - anterior[1]) > 4: break  # perdeu o centro (saiu da caixa)
        traj.append({'t': t, 'lat': float(esc[0]), 'lon': float(esc[1]), 'p': float(esc[2])}); anterior = esc
        if esc[1] >= -6.5 and len(traj) > 6: break  # já em Espanha
    return traj

TRAJ = {m: trajetoria(m) for m in MODELOS_GRELHA}

# ---------------------------------------------------------------- costa e distâncias
from shapely.geometry import shape, Point
from shapely.ops import unary_union
import shapely
terra = json.load(gzip.open(os.path.join(RAIZ, 'software', 'signalk-arlequin-rota', 'dados', 'terra.geojson.gz'), 'rt', encoding='utf-8'))
feats = terra['features'] if 'features' in terra else [terra]
TERRA = unary_union([shape(f['geometry']) for f in feats])
TERRA_PT = shapely.clip_by_rect(TERRA, -11, 36, -6, 42.5)

def dist_costa_mn(lat, lon):
    d = TERRA_PT.distance(Point(lon, lat))  # graus
    return d * 60 * math.cos(math.radians(lat)) if TERRA_PT.bounds[0] <= lon else d * 60

def mn_entre(a, b):
    dlat = (b[0] - a[0]) * 60; dlon = (b[1] - a[1]) * 60 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(dlat, dlon)

def rumo_para(a, b):
    dlat = (b[0] - a[0]) * 60; dlon = (b[1] - a[1]) * 60 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.degrees(math.atan2(dlon, dlat)) % 360

def avancar(pos, rumo, mn):
    lat = pos[0] + mn * math.cos(math.radians(rumo)) / 60
    lon = pos[1] + mn * math.sin(math.radians(rumo)) / (60 * math.cos(math.radians(pos[0])))
    return (lat, lon)

# ---------------------------------------------------------------- simulações "se apanhados"
LIM = {'vento': 22, 'rajada': 30, 'ondas': 3}  # os limites a solo do planeador (lib/seguranca.js)
PARTIDAS = {'P4': ('O cenário do Ivo: 40 MN ao largo, entre Sines e Lisboa, às 05:00', (38.30, -10.05), '2026-11-11T05:00'),
            'P1': ('20 MN a oeste de Cascais, a regressar, às 06:00', (38.70, -9.85), '2026-11-11T06:00'),
            'P2': ('10 MN a sul do Cabo Espichel, a subir de Sines, às 06:00', (38.25, -9.35), '2026-11-11T06:00'),
            'P3': ('60 MN ao largo, a regressar de uma travessia, às 06:00', (38.60, -10.90), '2026-11-11T06:00')}
CASCAIS = (38.69, -9.42); SINES = (37.95, -8.87); PENICHE = (39.35, -9.38)
T0 = '2026-11-11T06:00'; TF = '2026-11-12T03:00'

def barra_fechada(ih):
    # Hs no ponto da barra (série da Open-Meteo Marine em 38,67 N 9,33 W, célula de mar): com 3 m de SW os Cachopos
    # rebentam, e com vazante pior. Não entra a maré (sem tabela do IH para 11/11 nesta ferramenta).
    mm = PONTOS_DADOS['barra_tejo']['mar']['hourly']; t = HORAS[ih]
    if t not in mm['time']: return False
    hs = mm['wave_height'][mm['time'].index(t)]
    return hs is not None and hs >= 3.0

def simular(modelo, p0, tatica, t0=T0):
    c = CAMPOS[modelo]; pos = p0; linhas = []; chegou = None
    for ih in range(ih_de(t0), ih_de(TF) + 1):
        v = c['v'].em(pos[0], pos[1], ih); r = c['r'].em(pos[0], pos[1], ih); d = c['d'].em(pos[0], pos[1], ih)
        hs = MAR_HS.em(pos[0], pos[1], ih); dcosta = dist_costa_mn(pos[0], pos[1])
        fator_mar = max(0.8, 1 - 0.04 * max(0, (hs if not math.isnan(hs) else 2) - 1))
        if tatica == 'cascais' or tatica == 'sines' or tatica == 'peniche':
            alvo = {'cascais': CASCAIS, 'sines': SINES, 'peniche': PENICHE}[tatica]
            rumo = rumo_para(pos, alvo); vel = 6.0 * fator_mar
            contra = (abs(((d - rumo) + 180) % 360 - 180) < 50) if not math.isnan(d) else False
            if contra and v > 25: vel *= 0.7  # a motor contra vento e mar fortes
            if contra and v > 35: vel *= 0.6
        elif tatica == 'capa':  # à capa: deriva a ~1,5 nó, 40° para sotavento da perpendicular ao vento
            rumo = ((d + 180) % 360 + 40) % 360 if not math.isnan(d) else 90; vel = 1.5
        elif tatica == 'fugir_NW':
            rumo = 315; vel = 5.0 * fator_mar
            if not math.isnan(d) and abs(((d - rumo) + 180) % 360 - 180) < 45: vel *= 0.6
        elif tatica == 'correr':  # correr com o tempo, drogue à popa
            rumo = (d + 180) % 360 if not math.isnan(d) else 45; vel = 4.0
        linhas.append({'t': HORAS[ih], 'lat': pos[0], 'lon': pos[1], 'vento': v, 'rajada': r, 'dir': d, 'hs': hs, 'costa': dcosta, 'rumo': rumo, 'vel': vel,
                       'barra': barra_fechada(ih) if tatica == 'cascais' else None})
        if tatica in ('cascais', 'sines', 'peniche') and mn_entre(pos, alvo) <= vel:
            chegou = HORAS[ih]; break
        novo = avancar(pos, rumo, vel)
        if tatica in ('capa', 'correr', 'fugir_NW') and dist_costa_mn(novo[0], novo[1]) < 1:
            linhas[-1]['encalhou'] = True; break
        pos = novo
    return {'modelo': modelo, 'tatica': tatica, 'linhas': linhas, 'chegou': chegou}

TATICAS = {'cascais': 'Correr para Cascais / barra do Tejo', 'sines': 'Correr para Sines', 'peniche': 'Correr para Peniche',
           'capa': 'Pôr-se à capa onde está', 'fugir_NW': 'Fugir para noroeste a 5 nós', 'correr': 'Correr com o tempo (drogue à popa)'}

def resumo(sim):
    L = sim['linhas']
    vmax = max((l['vento'] for l in L if not math.isnan(l['vento'])), default=float('nan'))
    rmax = max((l['rajada'] for l in L if not math.isnan(l['rajada'])), default=float('nan'))
    hmax = max((l['hs'] for l in L if not math.isnan(l['hs'])), default=float('nan'))
    cmin = min(l['costa'] for l in L)
    acima = sum(1 for l in L if (not math.isnan(l['vento']) and l['vento'] > LIM['vento']) or (not math.isnan(l['rajada']) and l['rajada'] > LIM['rajada']) or (not math.isnan(l['hs']) and l['hs'] > LIM['ondas']))
    barra = [l['t'] for l in L if l.get('barra')]
    return dict(vmax=vmax, rmax=rmax, hmax=hmax, cmin=cmin, acima=acima, chegou=sim['chegou'], barra=barra, encalhou=any(l.get('encalhou') for l in L), horas=len(L))

SIMS = {}
for pk, (desc, p0, t0) in PARTIDAS.items():
    for tk in TATICAS:
        for m in MODELOS_GRELHA:
            SIMS[(pk, tk, m)] = simular(m, p0, tk, t0)

# ---------------------------------------------------------------- figuras
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MPoly

def fig_b64(fig):
    buf = io.BytesIO(); fig.savefig(buf, format='png', dpi=110, bbox_inches='tight'); plt.close(fig)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')

def desenhar_terra(ax):
    geoms = list(TERRA_PT.geoms) if hasattr(TERRA_PT, 'geoms') else [TERRA_PT]
    for g in geoms:
        if g.is_empty: continue
        polys = list(g.geoms) if hasattr(g, 'geoms') else [g]
        for p in polys:
            ax.add_patch(MPoly(np.array(p.exterior.coords), closed=True, facecolor='#e8e2d2', edgecolor='#8a8070', linewidth=0.6, zorder=2))

def figura_mapa(ih_vento):
    fig, ax = plt.subplots(figsize=(8.6, 7.2))
    ax.set_xlim(-14.5, -6.5); ax.set_ylim(35.0, 41.5); ax.set_aspect(1 / math.cos(math.radians(38)))
    desenhar_terra(ax)
    # vento ECMWF à hora escolhida (setas e cor)
    c = CAMPOS['ecmwf_ifs025']
    X, Y, U, V, S = [], [], [], [], []
    for la in LATS[::2]:
        for lo in LONS[::2]:
            if lo < -14.5 or la < 35: continue
            v = c['v'].em(la, lo, ih_vento); d = c['d'].em(la, lo, ih_vento)
            if math.isnan(v) or math.isnan(d): continue
            X.append(lo); Y.append(la); U.append(-math.sin(math.radians(d)) * v); V.append(-math.cos(math.radians(d)) * v); S.append(v)
    q = ax.quiver(X, Y, U, V, S, cmap='YlOrRd', scale=600, width=0.004, zorder=3, clim=(10, 50))
    fig.colorbar(q, ax=ax, shrink=0.6, label='vento médio ECMWF (nós) às ' + HORAS[ih_vento][11:16] + ' UTC de ' + HORAS[ih_vento][8:10] + '/11')
    for m, cor, nome in (('ecmwf_ifs025', '#1a4fa0', 'ECMWF'), ('gfs_seamless', '#b0281e', 'GFS')):
        tr = TRAJ[m]
        if not tr: continue
        ax.plot([x['lon'] for x in tr], [x['lat'] for x in tr], '-', color=cor, linewidth=2.2, zorder=5, label=f'centro {nome} (mín. {min(x["p"] for x in tr):.0f} hPa)')
        for x in tr:
            if x['t'].endswith(('00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00')) and x['lon'] > -14.5:
                ax.plot(x['lon'], x['lat'], 'o', color=cor, markersize=5, zorder=6)
                ax.annotate(x['t'][11:13] + 'h', (x['lon'], x['lat']), textcoords='offset points', xytext=(4, 4), fontsize=8, color=cor, zorder=7)
    for nome, (la, lo) in (('Lisboa', (38.72, -9.14)), ('Sines', (37.95, -8.87)), ('Peniche', (39.36, -9.38)), ('C. S. Vicente', (37.02, -8.99)), ('Figueira', (40.15, -8.87)), ('Porto', (41.15, -8.68))):
        ax.plot(lo, la, 'k.', zorder=6); ax.annotate(nome, (lo, la), textcoords='offset points', xytext=(5, -3), fontsize=8, zorder=7)
    for pk, (desc, p0, t0) in PARTIDAS.items():
        ax.plot(p0[1], p0[0], marker='*', color='#0a7d3a', markersize=13, zorder=8, markeredgecolor='k')
        ax.annotate(pk, (p0[1], p0[0]), textcoords='offset points', xytext=(6, 6), fontsize=9, color='#0a7d3a', weight='bold', zorder=8)
    ax.set_xlabel('longitude'); ax.set_ylabel('latitude'); ax.grid(True, alpha=0.3); ax.legend(loc='lower left', fontsize=8)
    ax.set_title('Depressão Charles: trajetória prevista do centro (ECMWF e GFS) e vento ECMWF', fontsize=10)
    return fig_b64(fig)

def figura_series(nome, titulo):
    d = PONTOS_DADOS[nome]; h = d['atm']['hourly']; t = h['time']; n = len(t)
    x = np.arange(n); etiquetas = [s[5:16].replace('T', ' ') for s in t]
    fig, axs = plt.subplots(3, 1, figsize=(9, 7.2), sharex=True)
    modelos = [k.replace('wind_speed_10m_', '') for k in h if k.startswith('wind_speed_10m_')]
    vs = np.array([[np.nan if v is None else v for v in h['wind_speed_10m_' + m]] for m in modelos])
    rs = np.array([[np.nan if v is None else v for v in h['wind_gusts_10m_' + m]] for m in modelos])
    axs[0].fill_between(x, np.nanmin(vs, 0), np.nanmax(vs, 0), color='#9ec5e8', alpha=0.6, label='vento médio: 5 modelos')
    axs[0].plot(x, vs[0], color='#1a4fa0', linewidth=1.6, label='vento ECMWF')
    axs[0].fill_between(x, np.nanmin(rs, 0), np.nanmax(rs, 0), color='#f3b7a0', alpha=0.5, label='rajadas: 5 modelos')
    axs[0].plot(x, rs[0], color='#b0281e', linewidth=1.2, label='rajada ECMWF')
    axs[0].axhline(LIM['vento'], color='#1a4fa0', linestyle=':', linewidth=1); axs[0].axhline(LIM['rajada'], color='#b0281e', linestyle=':', linewidth=1)
    axs[0].set_ylabel('nós'); axs[0].legend(fontsize=7, ncol=2, loc='upper left'); axs[0].set_title(titulo, fontsize=10)
    dirs = [np.nan if v is None else v for v in h['wind_direction_10m_ecmwf_ifs025']]
    ax2 = axs[1]; ax2.plot(x, [np.nan if v is None else v for v in h['pressure_msl_ecmwf_ifs025']], color='k', linewidth=1.5, label='pressão ECMWF (hPa)')
    ax2.set_ylabel('hPa'); ax2b = ax2.twinx(); ax2b.plot(x, dirs, '.', color='#0a7d3a', markersize=4, label='direção do vento ECMWF (°)'); ax2b.set_ylim(0, 360); ax2b.set_yticks([0, 90, 180, 270, 360]); ax2b.set_yticklabels(['N', 'E', 'S', 'W', 'N'])
    ax2.legend(fontsize=7, loc='lower left'); ax2b.legend(fontsize=7, loc='lower right')
    mm = d['mar']['hourly']; tm = mm['time']; xm = np.arange(len(tm))
    axs[2].plot(xm, [np.nan if v is None else v for v in mm['wave_height']], color='#1a4fa0', linewidth=1.6, label='altura significativa Hs (m)')
    axs[2].plot(xm, [np.nan if v is None else v for v in mm['swell_wave_height']], color='#6a7fa0', linewidth=1, linestyle='--', label='ondulação (swell) Hs')
    axs[2].axhline(LIM['ondas'], color='#1a4fa0', linestyle=':', linewidth=1)
    axs[2].set_ylabel('m'); axs[2].legend(fontsize=7, loc='upper left')
    ax3b = axs[2].twinx(); ax3b.plot(xm, [np.nan if v is None else v for v in mm['wave_period']], color='#b0281e', linewidth=1, label='período (s)'); ax3b.set_ylabel('s'); ax3b.legend(fontsize=7, loc='upper right')
    for ax in axs: ax.grid(True, alpha=0.3)
    passo = 6; axs[2].set_xticks(x[::passo]); axs[2].set_xticklabels(etiquetas[::passo], rotation=45, ha='right', fontsize=7)
    # marcar agora
    if PRIMEIRA_HORA in t:
        for ax in axs: ax.axvline(t.index(PRIMEIRA_HORA), color='gray', linewidth=1)
    return fig_b64(fig)

def figura_sims(pk):
    desc, p0, t0 = PARTIDAS[pk]
    fig, axs = plt.subplots(2, 1, figsize=(9, 6.4), sharex=True)
    cores = {'cascais': '#1a4fa0', 'sines': '#b0281e', 'peniche': '#6a4fa0', 'capa': '#0a7d3a', 'fugir_NW': '#d08a00', 'correr': '#6b6b6b'}
    for tk, nome in TATICAS.items():
        s = SIMS[(pk, tk, 'ecmwf_ifs025')]; L = s['linhas']; x = [ih_de(l['t']) - ih_de(t0) for l in L]
        axs[0].plot(x, [l['rajada'] for l in L], color=cores[tk], linewidth=1.6, label=nome)
        axs[1].plot(x, [l['costa'] for l in L], color=cores[tk], linewidth=1.6)
    axs[0].axhline(LIM['rajada'], color='k', linestyle=':', linewidth=1); axs[0].set_ylabel('rajada no barco (nós, ECMWF)'); axs[0].legend(fontsize=7, ncol=2)
    axs[1].set_ylabel('distância à costa (MN)'); axs[1].axhline(5, color='k', linestyle=':', linewidth=1)
    axs[1].set_xlabel(f'horas desde as {t0[11:16]} de 11/11'); axs[0].set_title(f'{pk}: {desc}', fontsize=10)
    for ax in axs: ax.grid(True, alpha=0.3)
    return fig_b64(fig)

# ---------------------------------------------------------------- texto
def fmt(v, casas=0):
    return '—' if v is None or (isinstance(v, float) and math.isnan(v)) else f'{v:.{casas}f}'

def tabela_avisos():
    niv = {'red': 3, 'orange': 2, 'yellow': 1}; cor = {'red': '#d9342b', 'orange': '#e38a1a', 'yellow': '#d4b400'}
    continente = {k for k in NOMES_AREA if k not in ('MCN', 'MCS', 'MRM', 'MPS')}
    costa = {'LSB', 'STB', 'LRA', 'STM', 'BJA', 'FAR', 'CBR', 'AVR', 'PTO'}
    av = [a for a in AVISOS if a.get('awarenessLevelID') in niv and a.get('idAreaAviso') in continente
          and (a['awarenessLevelID'] != 'yellow' or (a['idAreaAviso'] in costa and a['awarenessTypeName'] in ('Vento', 'Agitação Marítima')))]
    av.sort(key=lambda a: (-niv[a['awarenessLevelID']], a['awarenessTypeName'], a['idAreaAviso'], a['startTime']))
    linhas = []
    for a in av:
        linhas.append(f'<tr><td><span style="background:{cor[a["awarenessLevelID"]]};color:#fff;padding:1px 6px;border-radius:3px">{ {"red":"vermelho","orange":"laranja","yellow":"amarelo"}[a["awarenessLevelID"]] }</span></td>'
                      f'<td>{a["awarenessTypeName"]}</td><td>{NOMES_AREA[a["idAreaAviso"]]}</td><td>{a["startTime"][5:16].replace("T", " ")} → {a["endTime"][5:16].replace("T", " ")}</td><td>{a.get("text") or ""}</td></tr>')
    return '\n'.join(linhas), len(av)

def tabela_trajetoria():
    linhas = []
    for m, nome in (('ecmwf_ifs025', 'ECMWF'), ('gfs_seamless', 'GFS')):
        for x in TRAJ[m]:
            if x['t'][14:16] != '00' or int(x['t'][11:13]) % 3: continue
            if x['lon'] < -14.5: continue
            # vento máximo na grelha a essa hora
            c = CAMPOS[m]; ih = ih_de(x['t']); v = np.nanmax(c['v'].v[:16, :, ih]); r = np.nanmax(c['r'].v[:16, :, ih])
            i, j = np.unravel_index(np.nanargmax(c['v'].v[:16, :, ih]), c['v'].v[:16, :, ih].shape)
            linhas.append(f'<tr><td>{nome}</td><td>{x["t"][5:16].replace("T", " ")}</td><td>{x["lat"]:.1f} N {abs(x["lon"]):.1f} W</td><td>{x["p"]:.0f}</td><td>{v:.0f} / {r:.0f}</td><td>{c["v"].lats[i]:.1f} N {abs(c["v"].lons[j]):.1f} W</td></tr>')
    return '\n'.join(linhas)

def tabela_sims(pk):
    linhas = []
    for tk, nome in TATICAS.items():
        for m, mn in (('ecmwf_ifs025', 'ECMWF'), ('gfs_seamless', 'GFS')):
            r = resumo(SIMS[(pk, tk, m)])
            fim = ('chega às ' + r['chegou'][11:16]) if r['chegou'] else ('encalha' if r['encalhou'] else f'ainda no mar às {TF[11:16]}')
            if tk == 'cascais' and r['chegou']:
                fim += '; barra fechada' if barra_fechada(ih_de(r['chegou'])) else '; barra praticável'
            linhas.append(f'<tr><td>{nome}</td><td>{mn}</td><td>{fmt(r["vmax"])}</td><td>{fmt(r["rmax"])}</td><td>{fmt(r["hmax"], 1)}</td><td>{fmt(r["cmin"])}</td><td>{r["acima"]}/{r["horas"]}</td><td>{fim}</td></tr>')
    return '\n'.join(linhas)

def serie_costa(nome, horas=('2026-11-11T06:00', '2026-11-11T09:00', '2026-11-11T12:00', '2026-11-11T15:00', '2026-11-11T18:00', '2026-11-11T21:00', '2026-11-12T00:00')):
    d = PONTOS_DADOS[nome]; h = d['atm']['hourly']; t = h['time']; mm = d['mar']['hourly']
    out = []
    for hh in horas:
        if hh not in t: continue
        i = t.index(hh)
        vs = [h['wind_speed_10m_' + m][i] for m in ('ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'meteofrance_seamless', 'ukmo_seamless')]
        rs = [h['wind_gusts_10m_' + m][i] for m in ('ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'meteofrance_seamless', 'ukmo_seamless')]
        vs = [v for v in vs if v is not None]; rs = [v for v in rs if v is not None]
        dd = h['wind_direction_10m_ecmwf_ifs025'][i]; p = h['pressure_msl_ecmwf_ifs025'][i]
        j = mm['time'].index(hh) if hh in mm['time'] else None
        hs = mm['wave_height'][j] if j is not None else None; wd = mm['wave_direction'][j] if j is not None else None
        out.append(f'<tr><td>{hh[5:16].replace("T", " ")}</td><td>{min(vs):.0f}–{max(vs):.0f}</td><td>{min(rs):.0f}–{max(rs):.0f}</td><td>{rumo_txt(dd)}</td><td>{fmt(p)}</td><td>{fmt(hs, 1)}</td><td>{rumo_txt(wd)}</td></tr>')
    return '\n'.join(out)

def rumo_txt(d):
    if d is None or (isinstance(d, float) and math.isnan(d)): return '—'
    pts = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    return pts[int((d + 22.5) // 45) % 8] + f' ({d:.0f}°)'

def passagem_centro():
    """Hora e sítio em que o centro cruza a costa (lon ≈ −9) por modelo."""
    out = []
    for m, nome in (('ecmwf_ifs025', 'ECMWF'), ('gfs_seamless', 'GFS')):
        tr = TRAJ[m]; cruz = None
        for a, b in zip(tr, tr[1:]):
            if a['lon'] < -8.9 <= b['lon'] or a['lon'] < -9.0 <= b['lon']:
                cruz = b; break
        if cruz: out.append(f'{nome}: o centro cruza a costa por volta das {cruz["t"][11:16]} a {cruz["lat"]:.1f} N (≈ {"Sines" if cruz["lat"] < 38.3 else "Cascais/Setúbal" if cruz["lat"] < 39.0 else "Peniche"}), com {cruz["p"]:.0f} hPa')
        elif tr: out.append(f'{nome}: o centro não cruza a costa dentro da grelha (último ponto {tr[-1]["lat"]:.1f} N {abs(tr[-1]["lon"]):.1f} W às {tr[-1]["t"][11:16]})')
    return out

# velocidade de deslocação do centro (ECMWF) entre 09 e 15
def velocidade_centro(m):
    tr = TRAJ[m]; pts = [x for x in tr if x['t'] in ('2026-11-11T09:00', '2026-11-11T15:00')]
    if len(pts) < 2: return None
    return mn_entre((pts[0]['lat'], pts[0]['lon']), (pts[1]['lat'], pts[1]['lon'])) / 6

def figura_obs():
    fig, axs = plt.subplots(2, 1, figsize=(9, 5.2), sharex=True)
    cores = ['#1a4fa0', '#b0281e', '#0a7d3a', '#d08a00', '#6a4fa0', '#6b6b6b']
    etiquetas = None
    for (idx, nome), cor in zip(ESTACOES.items(), cores):
        s = obs_serie(idx)
        if etiquetas is None: etiquetas = [x[0][5:16].replace('T', ' ') for x in s]
        x = np.arange(len(s))
        axs[0].plot(x, [np.nan if v[2] is None else v[2] for v in s], color=cor, linewidth=1.5, label=nome)
        axs[1].plot(x, [np.nan if v[1] is None else v[1] for v in s], color=cor, linewidth=1.5)
    axs[0].set_ylabel('pressão observada (hPa)'); axs[0].legend(fontsize=7, ncol=3); axs[0].set_title('Observações do IPMA, últimas 24 h (hora UTC)', fontsize=10)
    axs[1].set_ylabel('vento médio observado (nós)')
    if etiquetas:
        axs[1].set_xticks(np.arange(0, len(etiquetas), 3)); axs[1].set_xticklabels(etiquetas[::3], rotation=45, ha='right', fontsize=7)
    for ax in axs: ax.grid(True, alpha=0.3)
    return fig_b64(fig)

def tabela_obs():
    linhas = []
    for idx, nome in ESTACOES.items():
        s = [x for x in obs_serie(idx) if x[2] is not None or x[1] is not None]
        if not s: continue
        u = s[-1]; tres = [x for x in s if x[2] is not None]
        tend = (tres[-1][2] - tres[-4][2]) if len(tres) >= 4 else None
        linhas.append(f'<tr><td>{nome}</td><td>{u[0][5:16].replace("T", " ")}</td><td>{fmt(u[2], 1)}</td><td>{("%+.1f" % tend) if tend is not None else "—"}</td><td>{fmt(u[1])}</td><td>{DIR_IPMA.get(u[3], "—")}</td><td>{fmt(u[4], 1)}</td></tr>')
    return chr(10).join(linhas)

IMG_OBS = figura_obs() if OBS else ''
IMG_MAPA = figura_mapa(ih_de('2026-11-11T15:00'))
IMG_CASCAIS = figura_series('cascais_largo', 'Ao largo de Cascais (38,65 N 9,60 W): vento, pressão, direção e mar, 5 modelos')
IMG_SINES = figura_series('sines', 'Ao largo de Sines (37,93 N 8,95 W): vento, pressão, direção e mar, 5 modelos')
IMG_SIMS = {pk: figura_sims(pk) for pk in PARTIDAS}
AV_HTML, N_AV = tabela_avisos()
CRUZ = passagem_centro(); VEL = velocidade_centro('ecmwf_ifs025')

CSS = """body{font-family:'Segoe UI',Arial,sans-serif;font-size:9.6pt;line-height:1.4;color:#1b2430;margin:0}
h1{font-size:16pt;color:#0b3d5c;border-bottom:3px solid #0b3d5c;padding-bottom:4px;margin:0 0 4px}
h2{font-size:12.5pt;color:#0b3d5c;margin:14px 0 4px;border-bottom:1px solid #c9d6e0;page-break-after:avoid}
h3{font-size:10.5pt;color:#0b3d5c;margin:10px 0 3px;page-break-after:avoid}
table{border-collapse:collapse;width:100%;margin:4px 0;font-size:8.6pt;page-break-inside:auto} tr{page-break-inside:avoid}
th,td{border:1px solid #c9d6e0;padding:3px 5px;vertical-align:top;text-align:left} th{background:#e8f0f6}
img{max-width:100%;page-break-inside:avoid} .sub{color:#555;font-size:9pt} .caixa{border:1px solid #ddd;border-radius:5px;padding:6px 9px;margin:8px 0;font-size:9pt;background:#fbfaf6}
.alerta{border-left:5px solid #d9342b;background:#fff3f2} .nota{color:#555;font-size:8.5pt} ul,ol{margin:3px 0;padding-left:18px}
@page{size:A4 portrait;margin:12mm 12mm}"""

def html_boletim():
    sims_html = ''
    for pk, (desc, p0, t0) in PARTIDAS.items():
        sims_html += f'<h3>{pk}: {desc} ({p0[0]:.2f} N {abs(p0[1]):.2f} W)</h3><img src="{IMG_SIMS[pk]}">' \
                     f'<table><tr><th>Tática</th><th>Modelo</th><th>Vento máx. (nós)</th><th>Rajada máx.</th><th>Hs máx. (m)</th><th>Mín. à costa (MN)</th><th>Horas acima dos limites a solo</th><th>Fim</th></tr>{tabela_sims(pk)}</table>'
    return f'''<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><title>Depressão Charles — acompanhamento para o Arlequin</title><style>{CSS}</style></head><body>
<h1>Depressão Charles · acompanhamento e estudo para o Arlequin</h1>
<div class="sub">Boletim gerado a {AGORA.strftime('%d/%m/%Y %H:%M')} UTC (em novembro, UTC = hora de Lisboa) · fontes: avisos do IPMA (api.ipma.pt), comunicado n.º 2 do IPMA de 10/11 17:07, modelos ECMWF, GFS, ICON, Météo-France e UKMO pela Open-Meteo, mar pela Open-Meteo Marine · ferramenta: software/ferramentas/tempestade/charles.py</div>

<div class="caixa alerta"><b>O que é.</b> A depressão Charles vem de noroeste da Madeira (34 N 21 W, 989 hPa às 00:00 de 11/11, segundo o IPMA) e cruza o continente na tarde e noite de 11/11, com o centro a passar, segundo o IPMA, <b>entre Sines e o Cabo Carvoeiro</b>. É um sistema independente da Bruna, que fica quase parada a noroeste da Península até dia 13. {' · '.join(CRUZ)}{f' · Desloca-se a cerca de {VEL:.0f} nós (ECMWF, 09–15h)' if VEL else ''}. O IPMA avisa: no bordo sul do centro, rajadas de 100 a 120 km/h, localmente 140; ondas de sudoeste de 5 a 7 m a sul do Cabo Raso durante a tarde, máximas até 13 m; "elevada incerteza na trajetória e intensidade".</div>

<h2>0. Em direto: observações das estações do IPMA</h2>
<table><tr><th>Estação</th><th>Última hora (UTC)</th><th>Pressão (hPa)</th><th>Tendência 3 h</th><th>Vento médio (nós)</th><th>De</th><th>Chuva na hora (mm)</th></tr>{tabela_obs()}</table>
<img src="{IMG_OBS}">
<div class="nota">A pressão a cair depressa (mais de 3 hPa em 3 h) é o sinal de que o centro se aproxima; o mínimo marca a passagem; depois sobe e o vento roda. Cabo Raso é a estação mais perto do Arlequin.</div>

<h2>1. Avisos do IPMA em vigor ({N_AV})</h2>
<table><tr><th>Nível</th><th>Tipo</th><th>Distrito</th><th>De → até</th><th>Texto</th></tr>{AV_HTML}</table>

<h2>2. Trajetória do centro (dois modelos)</h2>
<img src="{IMG_MAPA}">
<div class="nota">Centro = mínimo de pressão numa grelha de 0,5° (33–40,5 N, 17–6 W), com continuidade de hora a hora. As estrelas são as três posições das simulações. As setas são o vento ECMWF às 15:00 de 11/11, cor pela força.</div>
<table><tr><th>Modelo</th><th>Hora</th><th>Centro</th><th>hPa</th><th>Vento máx. / rajada na grelha (nós)</th><th>Onde sopra mais</th></tr>{tabela_trajetoria()}</table>

<h2>3. Na nossa costa, hora a hora</h2>
<h3>Ao largo de Cascais (38,65 N 9,60 W)</h3>
<table><tr><th>Hora</th><th>Vento médio (5 modelos, nós)</th><th>Rajadas (nós)</th><th>Direção (ECMWF)</th><th>Pressão (hPa)</th><th>Hs (m)</th><th>Mar de</th></tr>{serie_costa('cascais_largo')}</table>
<img src="{IMG_CASCAIS}">
<h3>Ao largo de Sines (37,93 N 8,95 W)</h3>
<table><tr><th>Hora</th><th>Vento médio (5 modelos, nós)</th><th>Rajadas (nós)</th><th>Direção (ECMWF)</th><th>Pressão (hPa)</th><th>Hs (m)</th><th>Mar de</th></tr>{serie_costa('sines')}</table>
<img src="{IMG_SINES}">
<div class="nota">Os pontos de modelo a 0,25° suavizam o vento: nas rajadas e junto ao centro o real costuma passar o modelo em 10 a 20 %. Os avisos do IPMA (rajadas de 100–140 km/h = 55–75 nós) são a referência de segurança, não a média do modelo. Linhas ponteadas: os limites a solo do planeador do Arlequin (22 nós médios, 30 de rajada, 3 m de onda).</div>

<h2>4. Anatomia: onde está o perigo</h2>
<div class="caixa"><ul>
<li><b>O centro passa por cima de nós.</b> Com a trajetória de oeste para leste a passar entre Sines e Cascais, o Arlequin (Oeiras) fica a uns quilómetros do centro. A pressão cai dos 1008 hPa de hoje para 985–988 por volta das 15–17h e sobe depois depressa.</li>
<li><b>Lado sul, o perigoso.</b> O vento mais forte está sempre no bordo sul do centro (Setúbal, Sines, Algarve): o vento roda pela direita, S → SW → W → NW, a 45–55 nós médios e rajadas de 60–75, e sopra PARA a costa: é costa de sotavento com 5 a 7 m de mar. Ninguém sobrevive à capa a 10 MN de Sines nestas condições; é ir para o largo ou já lá estar.</li>
<li><b>Lado norte, o navegável.</b> A norte do centro (Cascais para cima, se o centro passar por Sines) o vento é mais fraco e roda pela esquerda, SE → E → NE → N, a soprar da terra para o mar: a costa não é de sotavento, mas o mar de SW continua a entrar, e a barra do Tejo fecha na mesma.</li>
<li><b>O salto.</b> Quando o centro passa, o vento muda de SE para N/NW em menos de uma hora, com 20 a 30 nós de diferença e o mar cruzado. É o momento de estar com o pano mínimo e o barco já virado para onde vai soprar.</li>
<li><b>A barra do Tejo</b> com 5 a 7 m de SW e vazante é intransponível: os Cachopos rebentam de lado a lado. Com a barra fechada, Cascais não é abrigo (a baía abre a S e SW) e o plano "correr para casa" morre à entrada.</li>
<li><b>Tempo útil.</b> O aviso laranja saiu na manhã de 10/11 e o vermelho à tarde, mais de 24 h antes. O planeador do Arlequin teria dito "não sair" desde domingo: ondas acima de 3 m e rajadas acima de 30 nós em toda a janela.</li>
</ul></div>

<h2>5. Simulações: e se fôssemos apanhados?</h2>
<div class="nota">Três posições às 06:00 de 11/11, quando o aviso começa a valer, e seis táticas, com a previsão interpolada na posição do barco hora a hora (ECMWF e GFS). Barco: 6 nós a motor e vela (menos com mar e vento de frente), à capa deriva 1,5 nós, a correr com o tempo 4 nós, a fugir 5. "Barra fechada" = Hs ≥ 3,5 m na barra. É um exercício de aprendizagem, não um plano: a resolução dos modelos não vê as rajadas nem o mar cruzado junto ao centro.</div>
{sims_html}

<h3>P4 hora a hora, ECMWF: as três táticas que interessam</h3>
<p><b>{TATICAS['fugir_NW']}</b></p><table><tr><th>Hora</th><th>Posição</th><th>Vento (nós)</th><th>Rajada</th><th>De</th><th>Hs (m)</th><th>Costa (MN)</th><th>Rumo e velocidade</th></tr>{tabela_horaria('P4', 'fugir_NW')}</table>
<p><b>{TATICAS['capa']}</b></p><table><tr><th>Hora</th><th>Posição</th><th>Vento (nós)</th><th>Rajada</th><th>De</th><th>Hs (m)</th><th>Costa (MN)</th><th>Rumo e velocidade</th></tr>{tabela_horaria('P4', 'capa')}</table>
<p><b>{TATICAS['cascais']}</b></p><table><tr><th>Hora</th><th>Posição</th><th>Vento (nós)</th><th>Rajada</th><th>De</th><th>Hs (m)</th><th>Costa (MN)</th><th>Rumo e velocidade</th></tr>{tabela_horaria('P4', 'cascais')}</table>
<h2>6. O que se aprende</h2>
<div class="caixa"><ol>
<li><b>A decisão certa foi tomada dias antes:</b> não estar no mar. A única tática que não aparece a vermelho nas simulações é a de quem ficou no porto.</li>
<li><b>Se apanhado a oeste de Cascais (P1), nunca correr para a barra.</b> Chega-se à entrada com a barra fechada e o pior do vento a chegar. Ir para noroeste cedo, ou pôr-se à capa com água por sotavento, dá menos vento e mantém a costa longe.</li>
<li><b>A sul do Espichel (P2) é a pior posição:</b> está no lado perigoso, com costa de sotavento. Só serve fugir para o largo logo às 06:00, para sudoeste ou oeste, antes de o vento rodar.</li>
<li><b>Ao largo (P3) a resposta é ficar ao largo.</b> Com 60 MN de água por sotavento, à capa ou a correr com o drogue passa-se o pior sem a costa a ameaçar; regressar só quando o mar de SW baixar, na manhã de 12/11.</li>
<li><b>Preparar o barco antes do vento, não durante:</b> 3.º rizo e foque de temporal no estai de Dyneema ao primeiro sinal (o planeador manda rizar aos 16 nós, 2.º rizo aos 22, 3.º aos 28); escotilhas e tambuchos fechados; arnês preso; drogue e cabresto prontos à popa; motor pronto mas sem o deixar a trabalhar com cabos na água; EPIRB, VHF 16 e telemóvel estanque à mão; comer e dormir antes.</li>
<li><b>À capa no Melody:</b> genoa enrolada até ao mínimo ou foque de temporal contra-amurado, grande no 3.º rizo, leme a sotavento e travado. Deriva a 1 a 2 nós a 40–50° da perpendicular ao vento, deixando um rasto de água morta por barlavento. Treinar com 20 nós antes de precisar com 45.</li>
<li><b>Correr com o tempo</b> só com drogue à popa, para o barco não acelerar na frente das vagas e atravessar-se. É a tática de quem tem muita água por sotavento, não de quem tem Portugal a 20 MN.</li>
<li><b>Os limites do planeador são os certos:</b> 22 nós médios, 30 de rajada e 3 m de onda a solo. Esta tempestade passa-os cinco vezes.</li>
</ol></div>

<div class="nota">Próxima atualização: correr de novo o charles.py (descarrega tudo e refaz o boletim). Os dados de cada corrida ficam guardados com a hora, para comparar a evolução da trajetória entre corridas.</div>
</body></html>'''

def tabela_horaria(pk, tk, m='ecmwf_ifs025'):
    L = SIMS[(pk, tk, m)]['linhas']; out = []
    for l in L:
        out.append(f'<tr><td>{l["t"][11:16]}</td><td>{l["lat"]:.2f} N {abs(l["lon"]):.2f} W</td><td>{fmt(l["vento"])}</td><td>{fmt(l["rajada"])}</td><td>{rumo_txt(l["dir"])}</td><td>{fmt(l["hs"], 1)}</td><td>{fmt(l["costa"])}</td><td>{fmt(l["rumo"])}° a {l["vel"]:.1f} nós</td></tr>')
    return chr(10).join(out)
html = html_boletim()
nome = f'boletim-{CARIMBO}'
io.open(os.path.join(SAIDA, nome + '.html'), 'w', encoding='utf-8').write(html)
io.open(os.path.join(SAIDA, 'ultimo.html'), 'w', encoding='utf-8').write(html)
chrome = os.environ.get('CHROME', r'C:\Program Files\Google\Chrome\Application\chrome.exe')
pdf = os.path.join(SAIDA, nome + '.pdf')
subprocess.run([chrome, '--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--print-to-pdf=' + pdf, 'file:///' + os.path.join(SAIDA, nome + '.html').replace(os.sep, '/')], capture_output=True, text=True)
import shutil; shutil.copyfile(pdf, os.path.join(SAIDA, 'ultimo.pdf'))
try:
    import fitz; print('PDF', pdf, 'páginas', fitz.open(pdf).page_count)
except Exception as e:
    print('PDF escrito (sem contagem de páginas):', e)
# hora a hora do cenário do Ivo no terminal
for tk in ('cascais', 'fugir_NW', 'capa'):
    for m in MODELOS_GRELHA:
        print('--- P4', TATICAS[tk], m)
        for l in SIMS[('P4', tk, m)]['linhas']:
            print(f"{l['t'][11:16]} {l['lat']:.2f}N {abs(l['lon']):.2f}W vento {fmt(l['vento'])} raj {fmt(l['rajada'])} {rumo_txt(l['dir'])} Hs {fmt(l['hs'], 1)} costa {fmt(l['costa'])} MN rumo {fmt(l['rumo'])}° {l['vel']:.1f} nós{' BARRA FECHADA' if l.get('barra') else ''}")
# resumo no terminal
print('centro cruza:', ' | '.join(CRUZ))
for pk in PARTIDAS:
    for tk in TATICAS:
        r = resumo(SIMS[(pk, tk, 'ecmwf_ifs025')])
        print(pk, tk, 'vmax', fmt(r['vmax']), 'rmax', fmt(r['rmax']), 'hs', fmt(r['hmax'], 1), 'costa min', fmt(r['cmin']), 'acima', r['acima'], 'chegou', r['chegou'], 'barra', r['barra'][:1], 'encalhou', r['encalhou'])
