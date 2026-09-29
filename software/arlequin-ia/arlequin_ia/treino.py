"""Treino dos modelos (LightGBM por quantis P10/P50/P90), teste com a última
saída, aceitação só se errar menos do que o modelo em uso (ou, no 1.º modelo,
do que a polar/curva de origem), versões em modelos/<nome>/vNNNN.json.gz e o
registo de tudo em modelos/registo.json."""

import gzip
import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

from .base import litros_volvo, stw_polar
from .dados import ler_previsoes, ler_saidas, ler_tabela
from .variaveis import preparar

QUANTIS = {'p10': 0.1, 'p50': 0.5, 'p90': 0.9}
PARAMETROS = {'objective': 'quantile', 'num_leaves': 15, 'learning_rate': 0.05, 'min_data_in_leaf': 40,
              'seed': 1, 'deterministic': True, 'force_col_wise': True, 'verbose': -1}
RONDAS = 200
HORAS_MINIMAS = 5.0
SEGUNDOS_POR_LINHA = 10

VARS_VENTO = ['latCel', 'lonCel', 'prevTws', 'prevTwd', 'horaDia', 'idadePrevH', 'tendPressao3h']
MODELOS = {
    'velocidade': {
        'alvo': 'stw',
        'variaveis': ['tws', 'twaAbs', 'rajada', 'prevOndas', 'prevPeriodo', 'ondasAnguloRel', 'balAdorno',
                      'balCaimento', 'adornoAbs', 'grandeRizos', 'genoaPct', 'rpm'],
        'filtro': lambda d: d['tws'].notna() & d['twaAbs'].notna() & d['stw'].notna(),
        'base': lambda d, polar: stw_polar(polar, d['twaAbs'], d['tws']),
    },
    'ventoForca': {
        'alvo': 'ventoRazao', 'variaveis': VARS_VENTO,
        'filtro': lambda d: d['ventoRazao'].notna(),
        'base': lambda d, polar: np.ones(len(d)),
    },
    'ventoDirecao': {
        'alvo': 'ventoDif', 'variaveis': VARS_VENTO,
        'filtro': lambda d: d['ventoDif'].notna(),
        'base': lambda d, polar: np.zeros(len(d)),
    },
    'consumo': {
        'alvo': 'litrosHora', 'variaveis': ['rpm', 'stw', 'prevOndas', 'ondasAnguloRel', 'balCaimento'],
        'filtro': lambda d: (d['rpm'] > 300) & d['litrosHora'].notna(),
        'base': lambda d, polar: litros_volvo(d['rpm']),
    },
}


def virgula(x, casas=1):
    return f'{x:.{casas}f}'.replace('.', ',')


def mae(a, b):
    return float(np.mean(np.abs(np.asarray(a, dtype=float) - np.asarray(b, dtype=float))))


def treinar_quantis(x, y):
    return {q: lgb.train({**PARAMETROS, 'alpha': a}, lgb.Dataset(x, y), num_boost_round=RONDAS)
            for q, a in QUANTIS.items()}


def celulas(d):
    """Horas de dados por célula de 2 nós de vento × 15° de ângulo (para o peso da AI no Node)."""
    chave = (d['tws'] // 2 * 2).astype(int).astype(str) + '|' + (d['twaAbs'] // 15 * 15).astype(int).astype(str)
    return {k: round(v * SEGUNDOS_POR_LINHA / 3600, 3) for k, v in chave.value_counts().items()}


def frases(nome, d, x, p50, polar):
    """Até 3 frases simples sobre o que o modelo aprendeu."""
    if nome == 'velocidade':
        vela = d[(d['rpm'].fillna(0) <= 0)].copy()
        if vela.empty:
            return []
        vela['cel'] = (vela['tws'] // 2 * 2).astype(int).astype(str) + '|' + (vela['twaAbs'] // 15 * 15).astype(int).astype(str)
        out = []
        for cel in vela['cel'].value_counts().index[:3]:
            g = vela[vela['cel'] == cel]
            linha = g[x.columns].median().to_frame().T
            v = float(p50.predict(linha)[0])
            pol = float(stw_polar(polar, linha['twaAbs'], linha['tws'])[0])
            out.append(f'a {linha["twaAbs"].iloc[0]:.0f}° com {linha["tws"].iloc[0]:.0f} nós andas {virgula(v)} nós '
                       f'(a polar dizia {virgula(pol)})')
        return out
    if nome == 'consumo':
        c = d.assign(r=(d['rpm'] / 100).round() * 100)
        out = []
        for r in c['r'].value_counts().index[:3]:
            linha = c[c['r'] == r][x.columns].median().to_frame().T
            linha['rpm'] = r
            out.append(f'a {r:.0f} rpm gastas {virgula(float(p50.predict(linha)[0]))} L/h '
                       f'(a Volvo diz {virgula(float(litros_volvo([r])[0]))})')
        return out
    media = float(np.median(p50.predict(x)))
    if nome == 'ventoForca':
        pct = round((media - 1) * 100)
        return [f'o vento real é em média {abs(pct)}% mais {"forte" if pct >= 0 else "fraco"} do que a previsão']
    return [f'o vento real vem em média {abs(media):.0f}° mais {"à direita" if media >= 0 else "à esquerda"} '
            f'do que a previsão']


def versao_atual(pasta):
    f = pasta / 'atual'
    return f.read_text(encoding='utf-8').strip() if f.exists() else None


def carregar(pasta, versao):
    return json.loads(gzip.decompress((pasta / f'{versao}.json.gz').read_bytes()).decode('utf-8'))


def prever_guardado(modelo_json, d, quantil='p50'):
    b = lgb.Booster(model_str=modelo_json['nativo'][quantil])
    return b.predict(d[modelo_json['variaveis']])


def treinar_um(nome, d, pasta_modelos, agora, polar):
    spec = MODELOS[nome]
    linhas = d[spec['filtro'](d) & (d['sessao'] >= 0)]
    horas = len(linhas) * SEGUNDOS_POR_LINHA / 3600
    res = {'modelo': nome, 'data': agora.isoformat(), 'horas': round(horas, 2), 'n': int(len(linhas)),
           'versao': None, 'aceite': False}
    if horas < HORAS_MINIMAS:
        return {**res, 'motivo': f'poucos dados ({virgula(horas)} h de {virgula(HORAS_MINIMAS, 0)} h)'}
    sess = sorted(linhas['sessao'].unique())
    if len(sess) < 2:
        return {**res, 'motivo': 'só uma saída: são precisas pelo menos 2 (uma fica para o teste)'}
    teste = linhas[linhas['sessao'] == sess[-1]]
    treino = linhas[linhas['sessao'] != sess[-1]]
    x_tr, x_te = treino[spec['variaveis']], teste[spec['variaveis']]
    novo = treinar_quantis(x_tr, treino[spec['alvo']])
    mae_novo = mae(novo['p50'].predict(x_te), teste[spec['alvo']])
    mae_base = mae(spec['base'](teste, polar), teste[spec['alvo']])
    pasta = Path(pasta_modelos, nome)
    pasta.mkdir(parents=True, exist_ok=True)
    atual = versao_atual(pasta)
    mae_atual = mae(prever_guardado(carregar(pasta, atual), teste), teste[spec['alvo']]) if atual else None
    aceite = mae_novo <= mae_atual if atual else mae_novo < mae_base
    final = treinar_quantis(linhas[spec['variaveis']], linhas[spec['alvo']]) if aceite else novo
    numero = len(list(pasta.glob('v*.json.gz'))) + 1
    versao = f'v{numero:04d}'
    modelo = {
        'modelo': nome, 'versao': versao, 'criado': agora.isoformat(), 'alvo': spec['alvo'],
        'variaveis': spec['variaveis'], 'horas': res['horas'], 'n': res['n'], 'sessoes': len(sess),
        'mae': round(mae_novo, 4), 'maeAtual': None if mae_atual is None else round(mae_atual, 4),
        'maeBase': round(mae_base, 4), 'aceite': aceite,
        'quantis': {q: b.dump_model() for q, b in final.items()},
        'nativo': {q: b.model_to_string() for q, b in final.items()},
        'celulas': celulas(linhas) if nome == 'velocidade' else None,
        'frases': frases(nome, linhas, linhas[spec['variaveis']], final['p50'], polar),
    }
    (pasta / f'{versao}.json.gz').write_bytes(gzip.compress(json.dumps(modelo).encode('utf-8')))
    if aceite:
        (pasta / 'atual').write_text(versao, encoding='utf-8')
    motivo = ('erra menos do que ' + ('a versão em uso' if atual else 'a polar/curva de origem')) if aceite \
        else ('erra mais do que ' + ('a versão em uso' if atual else 'a polar/curva de origem'))
    return {**res, 'versao': versao, 'aceite': aceite, 'motivo': motivo, 'mae': modelo['mae'],
            'maeAtual': modelo['maeAtual'], 'maeBase': modelo['maeBase'], 'frases': modelo['frases']}


def treinar(base, polar, agora=None, incluir_simulado=False, modelos=None):
    """Treina todos os modelos com os dados de `base` (a pasta da caixa negra) e devolve o resumo."""
    agora = agora or pd.Timestamp.now(tz='UTC')
    df = ler_tabela(base)
    if not incluir_simulado:
        df = df[df['simulado'] != 1]
    d = preparar(df.reset_index(drop=True), ler_saidas(base), ler_previsoes(base))  # o balanço usa também as linhas não estáveis
    d = d[d['estavel'] == 1].reset_index(drop=True)
    pasta_modelos = Path(base, 'modelos')
    pasta_modelos.mkdir(parents=True, exist_ok=True)
    resultados = [treinar_um(n, d, pasta_modelos, agora, polar) for n in (modelos or MODELOS)]
    registo = pasta_modelos / 'registo.json'
    antigo = json.loads(registo.read_text(encoding='utf-8')) if registo.exists() else []
    registo.write_text(json.dumps(antigo + resultados, ensure_ascii=False, indent=1), encoding='utf-8')
    return resultados
