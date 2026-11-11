#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Vigilância em direto da estação meteorológica da torre VTS (Algés), Porto de Lisboa.

Fonte principal: portal "Meteorologia" da APL, feito pela Hidromod (AquaSafe)
  https://portodelisboa.hidromod.com/meteoapl/
A API REST que alimenta o portal é aberta:
  https://portodelisboa.hidromod.com/AquaSafeServer/rest/GetTimeSerieValuesByTimeSerieId/{id}/{inicio}/{fim}/?format=json
Séries (ids):
  Estação meteorológica de Algés (torre VTS, 38,6939 N 9,2343 W):
    664 vento médio (nós, amostra de 30 min)   667 direção (°)   663 pressão nível do mar (hPa)
    688 precipitação (mm)   1050 visibilidade (m)   665 temperatura (°C)
    679 / 681 / 682 previsão ICON 7 km (vento nós / direção / precipitação)
  Marégrafo de Alcântara: 849 nível medido (m ZH), 758 nível previsto MOHID, 759 sobre-elevação prevista, 1048 tabela de maré IH
  Boia ondógrafo da barra (38°37,4' N 9°23,3' W): 674 Hs, 690 Hmax, 677 Tp, 675 direção média
A estação NÃO publica rajadas: as rajadas vêm do AROME (Open-Meteo, modelo meteofrance_seamless) no ponto da estação,
e do METAR do aeroporto (LPPT) quando lá há rajada.

Uso:
  python vts_alges.py                      # imprime o resumo e grava figura + registo CSV em docs/tempestades/2026-11-11-charles
  python vts_alges.py --horas 48           # janela de medições para trás
  python vts_alges.py --sem-figura         # só terminal + CSV
"""
import argparse
import csv
import datetime as dt
import json
import math
import os
import re
import sys
import urllib.request

sys.stdout.reconfigure(encoding='utf-8')

APL = 'https://portodelisboa.hidromod.com/AquaSafeServer/rest/'
EST_LAT, EST_LON = 38.693934, -9.234286
RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
PASTA_DEF = os.path.join(RAIZ, 'docs', 'tempestades', '2026-11-11-charles')

SERIES = {
    'vento': 664, 'dir': 667, 'pressao': 663, 'precip': 688, 'vis': 1050, 'temp': 665,
    'icon_vento': 679, 'icon_dir': 681, 'icon_precip': 682,
    'nivel_medido': 849, 'nivel_previsto': 758, 'sobreelev': 759, 'tabela': 1048,
    'hs': 674, 'hmax': 690, 'tp': 677, 'dir_mar': 675,
}
RUMOS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']


def rumo(graus):
    if graus is None or (isinstance(graus, float) and math.isnan(graus)):
        return '--'
    return RUMOS[int((graus / 22.5) + 0.5) % 16]


def get(url, timeout=40):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 arlequin-meteo/1.0', 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8', 'replace')


def _data(s):
    m = re.search(r'(-?\d+)', s)
    return dt.datetime.fromtimestamp(int(m.group(1)) / 1000, dt.timezone.utc)


def ler_serie(sid, t0, t1):
    """Devolve lista de (datetime UTC, valor) da série sid entre t0 e t1."""
    f = '%Y-%m-%dT%H:%M:%S.000Z'
    url = APL + 'GetTimeSerieValuesByTimeSerieId/%d/%s/%s/?format=json' % (sid, t0.strftime(f), t1.strftime(f))
    d = json.loads(get(url))
    vals = d.get('Values', []) if isinstance(d, dict) else d
    out = []
    for v in vals:
        try:
            out.append((_data(v['DateTime']), float(v['Value'])))
        except (KeyError, TypeError, ValueError):
            continue
    out.sort()
    return out


def descarregar(horas_atras, horas_frente):
    agora = dt.datetime.now(dt.timezone.utc)
    t0 = agora - dt.timedelta(hours=horas_atras)
    t1 = agora + dt.timedelta(hours=horas_frente)
    dados = {}
    for nome, sid in SERIES.items():
        try:
            dados[nome] = ler_serie(sid, t0, t1)
        except Exception as e:  # noqa: BLE001 - queremos continuar com o que houver
            print('  aviso: série %s (%d) falhou: %s' % (nome, sid, e))
            dados[nome] = []
    return agora, dados


def arome(agora, horas_frente):
    """Vento médio, rajada, direção e pressão do AROME (Open-Meteo) no ponto da estação."""
    url = ('https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f'
           '&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,surface_pressure'
           '&wind_speed_unit=kn&timezone=UTC&past_hours=24&forecast_days=3&models=meteofrance_seamless' % (EST_LAT, EST_LON))
    try:
        h = json.loads(get(url))['hourly']
    except Exception as e:  # noqa: BLE001
        print('  aviso: AROME falhou:', e)
        return []
    out = []
    for i, t in enumerate(h['time']):
        when = dt.datetime.strptime(t, '%Y-%m-%dT%H:%M').replace(tzinfo=dt.timezone.utc)
        if when > agora + dt.timedelta(hours=horas_frente):
            break
        out.append((when, h['wind_speed_10m'][i], h['wind_gusts_10m'][i], h['wind_direction_10m'][i], h['surface_pressure'][i]))
    return out


def metar():
    try:
        d = json.loads(get('https://aviationweather.gov/api/data/metar?ids=LPPT&format=json&hours=6'))
    except Exception as e:  # noqa: BLE001
        print('  aviso: METAR falhou:', e)
        return []
    return [(m.get('reportTime'), m.get('wdir'), m.get('wspd'), m.get('wgst'), m.get('altim')) for m in d]


def avisos_ipma():
    try:
        av = json.loads(get('https://api.ipma.pt/open-data/forecast/warnings/warnings_www.json'))
    except Exception as e:  # noqa: BLE001
        print('  aviso: IPMA falhou:', e)
        return []
    return [a for a in av if a.get('idAreaAviso') == 'LSB' and a.get('awarenessLevelID') != 'green']


def ultimo(serie):
    return serie[-1] if serie else (None, None)


def valor_em(serie, quando):
    """Valor da série mais próximo (no tempo) de `quando`, ou None."""
    if not serie:
        return None
    melhor = min(serie, key=lambda p: abs((p[0] - quando).total_seconds()))
    if abs((melhor[0] - quando).total_seconds()) > 3600:
        return None
    return melhor[1]


def resumo(agora, dados, prev, met, avisos):
    f = lambda t: t.astimezone(dt.timezone.utc).strftime('%d/%m %H:%M')  # noqa: E731 - hora local = UTC em novembro
    tv, v = ultimo(dados['vento'])
    _, d = ultimo(dados['dir'])
    tp_, p = ultimo(dados['pressao'])
    _, chuva = ultimo(dados['precip'])
    _, vis = ultimo(dados['vis'])
    print('=' * 78)
    print('ESTAÇÃO DA TORRE VTS (Algés) — última leitura %s (hora local = UTC)' % (f(tv) if tv else '--'))
    print('=' * 78)
    if v is not None:
        print('  Vento médio (30 min): %5.1f nós  de %s (%.0f°)' % (v, rumo(d), d if d is not None else float('nan')))
    if p is not None:
        p3 = valor_em(dados['pressao'], tp_ - dt.timedelta(hours=3))
        tend = ('  (Δ3h %+.1f hPa)' % (p - p3)) if p3 is not None else ''
        print('  Pressão: %.1f hPa%s' % (p, tend))
    if chuva is not None:
        print('  Precipitação (30 min): %.1f mm   Visibilidade: %s' % (chuva, ('%.0f m' % vis) if vis is not None else '--'))
    janela = [x for x in dados['vento'] if x[0] >= agora - dt.timedelta(hours=24)]
    if janela:
        tmax, vmax = max(janela, key=lambda x: x[1])
        print('  Máximo das últimas 24 h: %.1f nós às %s' % (vmax, f(tmax)))
    tn, n = ultimo(dados['nivel_medido'])
    if n is not None:
        print('  Nível do mar (Alcântara, ZH): %.2f m às %s' % (n, f(tn)))
    th, hs = ultimo(dados['hs'])
    if hs is not None:
        _, hmax = ultimo(dados['hmax'])
        _, tp = ultimo(dados['tp'])
        _, dm = ultimo(dados['dir_mar'])
        print('  Boia da barra às %s: Hs %.1f m, Hmax %.1f m, Tp %.1f s, de %s' % (f(th), hs, hmax or float('nan'), tp or float('nan'), rumo(dm)))
    if met:
        print('  METAR LPPT (aeroporto):')
        for t, wd, ws, wg, alt in met[:3]:
            print('    %s  %s° %s nós%s  QNH %s' % (t, wd, ws, (' raj %s' % wg) if wg else '', alt))
    if avisos:
        print('  Avisos IPMA (Lisboa):')
        for a in avisos:
            print('    %-20s %-7s %s → %s  %s' % (a['awarenessTypeName'], a['awarenessLevelID'].upper(), a['startTime'][5:16], a['endTime'][5:16], a.get('text', '')))

    print()
    print('MEDIÇÕES DAS ÚLTIMAS 12 H (vento médio de 30 min; a estação não mede rajada)')
    print('  hora   vento  dir      pressão  chuva')
    for t, vv in dados['vento']:
        if t < agora - dt.timedelta(hours=12):
            continue
        dd = valor_em(dados['dir'], t)
        pp = valor_em(dados['pressao'], t)
        cc = valor_em(dados['precip'], t)
        print('  %s  %5.1f  %-4s %3.0f°  %6.1f  %4.1f' % (t.strftime('%H:%M'), vv, rumo(dd), dd or 0, pp or 0, cc or 0))

    print()
    print('PRÓXIMAS 24 H NO LOCAL — ICON 7 km (APL) e AROME (rajadas), maré prevista em Alcântara')
    print('  hora   ICON vento/dir   AROME médio  rajada  dir   pressão   nível(m)  sobre-elev')
    tab = {t: x for t, x in dados['tabela']}
    for h in range(0, 25):
        t = (agora + dt.timedelta(hours=h)).replace(minute=0, second=0, microsecond=0)
        iv = valor_em(dados['icon_vento'], t)
        idd = valor_em(dados['icon_dir'], t)
        a = next((x for x in prev if x[0] == t), None)
        nv = valor_em(dados['nivel_previsto'], t)
        se = valor_em(dados['sobreelev'], t)
        linha = '  %s  ' % t.strftime('%d %H:%M')
        linha += ('%5.1f %-4s      ' % (iv, rumo(idd))) if iv is not None else '   --           '
        if a:
            linha += '%5.1f      %5.1f   %-4s  %6.1f' % (a[1], a[2], rumo(a[3]), a[4])
        else:
            linha += '   --         --    --      --  '
        linha += ('   %5.2f' % nv) if nv is not None else '      --'
        linha += ('   %+.2f' % se) if se is not None else ''
        print(linha)
    if dados['tabela']:
        print('  Tabela de maré IH (Alcântara, ZH) + sobre-elevação prevista pela Hidromod:')
        for t, x in dados['tabela']:
            if agora - dt.timedelta(hours=6) <= t <= agora + dt.timedelta(hours=30):
                se = valor_em(dados['sobreelev'], t)
                tipo = 'PM' if x > 2.2 else 'BM'
                print('    %s %s %.2f m%s' % (t.strftime('%d/%m %H:%M'), tipo, x, (' (%+.2f)' % se) if se is not None else ''))


def figura(agora, dados, prev, avisos, caminho):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.dates as mdates
    import matplotlib.pyplot as plt

    fig, eixos = plt.subplots(4, 1, figsize=(12, 13), sharex=True)
    t_ini = agora - dt.timedelta(hours=24)
    t_fim = agora + dt.timedelta(hours=30)

    def xy(serie):
        s = [p for p in serie if t_ini <= p[0] <= t_fim]
        return [p[0] for p in s], [p[1] for p in s]

    ax = eixos[0]
    x, y = xy(dados['vento'])
    ax.plot(x, y, 'k.-', lw=1.5, label='Medido na torre VTS (média 30 min)')
    x, y = xy(dados['icon_vento'])
    ax.plot(x, y, color='tab:blue', lw=1.2, label='Previsão ICON 7 km (APL)')
    if prev:
        xs = [p[0] for p in prev if t_ini <= p[0] <= t_fim]
        ax.plot(xs, [p[1] for p in prev if t_ini <= p[0] <= t_fim], color='tab:orange', lw=1.2, label='AROME médio')
        ax.plot(xs, [p[2] for p in prev if t_ini <= p[0] <= t_fim], color='tab:red', lw=1.2, ls='--', label='AROME rajada')
    for lim, txt in ((34, 'F8 temporal'), (48, 'F10'), (64, 'F12 furacão')):
        ax.axhline(lim, color='grey', lw=0.6, ls=':')
        ax.text(t_fim, lim, ' ' + txt, va='center', fontsize=8, color='grey')
    ax.set_ylabel('nós')
    ax.set_title('Torre VTS de Algés — vento (a estação não mede rajadas; rajadas = AROME)')
    ax.legend(loc='upper left', fontsize=8)
    ax.grid(alpha=0.3)

    ax = eixos[1]
    x, y = xy(dados['dir'])
    ax.plot(x, y, 'k.', label='Medida')
    x, y = xy(dados['icon_dir'])
    ax.plot(x, y, '.', color='tab:blue', ms=3, label='ICON')
    ax.set_yticks([0, 90, 180, 270, 360])
    ax.set_yticklabels(['N', 'E', 'S', 'W', 'N'])
    ax.set_ylim(0, 360)
    ax.set_ylabel('direção')
    ax.legend(loc='upper left', fontsize=8)
    ax.grid(alpha=0.3)

    ax = eixos[2]
    x, y = xy(dados['pressao'])
    ax.plot(x, y, 'k.-', lw=1.5, label='Medida')
    if prev:
        xs = [p[0] for p in prev if t_ini <= p[0] <= t_fim]
        ax.plot(xs, [p[4] for p in prev if t_ini <= p[0] <= t_fim], color='tab:orange', lw=1.2, label='AROME')
    ax.set_ylabel('hPa')
    ax.legend(loc='upper left', fontsize=8)
    ax.grid(alpha=0.3)

    ax = eixos[3]
    x, y = xy(dados['nivel_medido'])
    ax.plot(x, y, 'k-', lw=1.5, label='Medido (Alcântara)')
    x, y = xy(dados['nivel_previsto'])
    ax.plot(x, y, color='tab:blue', lw=1.2, label='Previsto MOHID (maré + sobre-elevação)')
    for t, v in dados['tabela']:
        if t_ini <= t <= t_fim:
            ax.plot(t, v, 'v' if v > 2.2 else '^', color='tab:green', ms=7)
            ax.text(t, v + 0.12, t.strftime('%H:%M'), ha='center', fontsize=7, color='tab:green')
    ax.set_ylabel('m acima do ZH')
    ax.legend(loc='upper left', fontsize=8)
    ax.grid(alpha=0.3)

    for ax in eixos:
        ax.axvline(agora, color='red', lw=1)
        for a in avisos:
            if a['awarenessTypeName'].lower().startswith('vento'):
                cor = {'red': 'red', 'orange': 'orange', 'yellow': 'gold'}.get(a['awarenessLevelID'], 'grey')
                ax.axvspan(dt.datetime.fromisoformat(a['startTime']).replace(tzinfo=dt.timezone.utc),
                           dt.datetime.fromisoformat(a['endTime']).replace(tzinfo=dt.timezone.utc), color=cor, alpha=0.12)
    eixos[-1].xaxis.set_major_formatter(mdates.DateFormatter('%d/%m\n%H:%M', tz=dt.timezone.utc))
    eixos[-1].set_xlim(t_ini, t_fim)
    fig.suptitle('Algés em direto — %s (hora local = UTC) · faixas = aviso IPMA de vento (Lisboa)' % agora.strftime('%d/%m/%Y %H:%M'), fontsize=11)
    fig.tight_layout()
    fig.savefig(caminho, dpi=110)
    plt.close(fig)


def registar_csv(dados, caminho):
    """Junta as medições ao registo CSV (sem duplicar horas)."""
    linhas = {}
    if os.path.exists(caminho):
        with open(caminho, newline='', encoding='utf-8') as f:
            for r in csv.DictReader(f):
                linhas[r['hora_utc']] = r
    for t, v in dados['vento']:
        k = t.strftime('%Y-%m-%dT%H:%M')
        linhas[k] = {'hora_utc': k, 'vento_nos': '%.1f' % v,
                     'dir_graus': '%.0f' % (valor_em(dados['dir'], t) or 0),
                     'pressao_hpa': '%.1f' % (valor_em(dados['pressao'], t) or 0),
                     'precip_mm': '%.1f' % (valor_em(dados['precip'], t) or 0),
                     'nivel_m': '%.2f' % (valor_em(dados['nivel_medido'], t) or 0)}
    with open(caminho, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['hora_utc', 'vento_nos', 'dir_graus', 'pressao_hpa', 'precip_mm', 'nivel_m'])
        w.writeheader()
        for k in sorted(linhas):
            w.writerow(linhas[k])
    return len(linhas)


def main():
    ap = argparse.ArgumentParser(description='Estação da torre VTS de Algés em direto')
    ap.add_argument('--pasta', default=PASTA_DEF)
    ap.add_argument('--horas', type=int, default=36, help='horas de medições para trás')
    ap.add_argument('--sem-figura', action='store_true')
    args = ap.parse_args()
    os.makedirs(args.pasta, exist_ok=True)

    agora, dados = descarregar(args.horas, 48)
    prev = arome(agora, 48)
    met = metar()
    avisos = avisos_ipma()
    resumo(agora, dados, prev, met, avisos)
    n = registar_csv(dados, os.path.join(args.pasta, 'alges-vts-registo.csv'))
    print('\nRegisto CSV: %d medições em %s' % (n, os.path.join(args.pasta, 'alges-vts-registo.csv')))
    if not args.sem_figura:
        carimbo = agora.strftime('%Y%m%d-%H%M')
        destino = os.path.join(args.pasta, 'alges-vts-%s.png' % carimbo)
        figura(agora, dados, prev, avisos, destino)
        import shutil
        shutil.copyfile(destino, os.path.join(args.pasta, 'alges-vts-ultimo.png'))
        print('Figura: %s' % destino)


if __name__ == '__main__':
    main()
