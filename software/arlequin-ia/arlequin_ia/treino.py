"""Treino dos modelos (LightGBM por quantis P10/P50/P90), teste com a última
saída (com as anteriores juntas até o teste ter 1 h), aceitação só se errar menos do que o modelo em uso (ou, no 1.º modelo,
do que a origem: a polar, a previsão em bruto ou a curva da Volvo), versões em modelos/<nome>/vNNNN.json.gz e o
registo de tudo em modelos/registo.json."""

import gzip
import json
import os
import re
import sys
import traceback
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
LINHAS_TESTE_MINIMAS = 3600 // SEGUNDOS_POR_LINHA  # o teste tem de ter pelo menos 1 h (360 linhas de 10 s)
# Abaixo disto o motor está parado. O plugin J1939 publica as rotações como null (aqui NaN) quando não
# chega nenhuma trama EEC1 há 5 s: tanto é a ignição desligada (a ECU cala-se) como o adaptador USB-CAN
# solto ou o candump em baixo. Por isso NaN sozinho não quer dizer "à vela": só conta com uma vela em cima.
MOTOR_PARADO_RPM = 300


def a_vela(d):
    """À vela: pelo menos uma vela em cima (grande não arriada ou genoa aberta, como marcado na página Velas)
    e rotações conhecidas ≤ MOTOR_PARADO_RPM, ou sem leitura (com a ignição desligada confia-se nas velas).
    A motor com as velas em baixo nunca é vela."""
    vela_em_cima = (d['grandeRizos'] >= 0) | (d['genoaPct'] > 0)
    return vela_em_cima & (d['rpm'].isna() | (d['rpm'] <= MOTOR_PARADO_RPM))

VARS_VENTO = ['latCel', 'lonCel', 'prevTws', 'prevTwd', 'horaDia', 'idadePrevH', 'tendPressao3h']
# Os modelos da velocidade e do consumo servem para planear (Parte 3): só usam o que se sabe antes de partir.
# O que só se mede no mar (vento e rajada medidos, adorno, balanço, a STW no consumo) fica de fora.
MODELOS = {
    'velocidade': {
        'alvo': 'stw',
        # o vento é a previsão EM BRUTO (prevTws, prevRajada e o ângulo twaPrevAbs entre a proa e o vento
        # previsto), sem a correção da AI: a AI aprende "com esta previsão, andaste X". No planeamento recebe
        # também a previsão em bruto (a correção do vento serve a polar e as regras, e não entra aqui para não
        # ser contada duas vezes)
        'variaveis': ['prevTws', 'twaPrevAbs', 'prevRajada', 'prevOndas', 'prevPeriodo', 'ondasAnguloRel',
                      'grandeRizos', 'genoaPct'],
        # só à vela (a motor a polar não quer dizer nada) e só em horas com previsão arquivada
        'filtro': lambda d: d['prevTws'].notna() & d['twaPrevAbs'].notna() & d['stw'].notna() & a_vela(d),
        # a origem é a polar com a mesma informação que o modelo tem: a previsão em bruto
        'base': lambda d, polar: stw_polar(polar, d['twaPrevAbs'], d['prevTws']),
        'origem': 'a polar',  # com que o 1.º modelo se compara (no motivo do registo)
    },
    'ventoForca': {
        'alvo': 'ventoRazao', 'variaveis': VARS_VENTO,
        'filtro': lambda d: d['ventoRazao'].notna(),
        'base': lambda d, polar: np.ones(len(d)),
        'origem': 'a previsão em bruto',
    },
    'ventoDirecao': {
        'alvo': 'ventoDif', 'variaveis': VARS_VENTO,
        'filtro': lambda d: d['ventoDif'].notna(),
        'base': lambda d, polar: np.zeros(len(d)),
        'origem': 'a previsão em bruto',
    },
    'consumo': {
        'alvo': 'litrosHora', 'variaveis': ['rpm', 'prevOndas', 'ondasAnguloRel'],
        # só o caudal medido pelo MDI: a estimativa do plugin J1939 é a própria curva da Volvo (seria circular)
        'filtro': lambda d: (d['rpm'] > MOTOR_PARADO_RPM) & d['litrosHora'].notna() & (d['consumoMedido'] == 1),
        'base': lambda d, polar: litros_volvo(d['rpm']),
        'origem': 'a curva da Volvo',
    },
}


def virgula(x, casas=1):
    return f'{x:.{casas}f}'.replace('.', ',')


def mae(a, b):
    return float(np.mean(np.abs(np.asarray(a, dtype=float) - np.asarray(b, dtype=float))))


def treinar_quantis(x, y):
    return {q: lgb.train({**PARAMETROS, 'alpha': a}, lgb.Dataset(x, y), num_boost_round=RONDAS)
            for q, a in QUANTIS.items()}


def chave_celula(d):
    """'nós|graus' da célula de 2 nós de vento previsto em bruto (prevTws) × 15° de ângulo ao vento previsto
    (twaPrevAbs): o mesmo vento que o modelo recebe e com que o planeador chama pesoCelula
    (signalk-arlequin-ia/lib/modelos.js)."""
    return (d['prevTws'] // 2 * 2).astype(int).astype(str) + '|' + (d['twaPrevAbs'] // 15 * 15).astype(int).astype(str)


def celulas(d):
    """Horas de dados por célula (ver chave_celula), para o peso da AI no Node."""
    return {k: round(v * SEGUNDOS_POR_LINHA / 3600, 3) for k, v in chave_celula(d).value_counts().items()}


def frases(nome, d, x, p50, polar):
    """Até 3 frases simples sobre o que o modelo aprendeu."""
    if nome == 'velocidade':
        vela = d[a_vela(d)].copy()
        if vela.empty:
            return []
        vela['cel'] = chave_celula(vela)
        out = []
        for cel in vela['cel'].value_counts().index[:3]:
            g = vela[vela['cel'] == cel]
            linha = g[x.columns].median().to_frame().T
            v = float(p50.predict(linha)[0])
            pol = float(stw_polar(polar, linha['twaPrevAbs'], linha['prevTws'])[0])  # como a base: com a previsão
            out.append(f'a {linha["twaPrevAbs"].iloc[0]:.0f}° do vento previsto com {linha["prevTws"].iloc[0]:.0f} '
                       f'nós previstos andas {virgula(v)} nós (a polar dizia {virgula(pol)})')
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
    # arredonda-se primeiro: com menos de 1 (0% ou 0°) a frase é neutra, nunca "0% mais forte"
    if nome == 'ventoForca':
        pct = round((media - 1) * 100)
        if pct == 0:
            return ['o vento real é em média igual ao previsto']
        return [f'o vento real é em média {abs(pct)}% mais {"forte" if pct > 0 else "fraco"} do que a previsão']
    graus = round(media)
    if graus == 0:
        return ['o vento real vem em média da direção prevista']
    return [f'o vento real vem em média {abs(graus)}° mais {"à direita" if graus > 0 else "à esquerda"} '
            f'do que a previsão']


def escrever(caminho, dados):
    """Escreve de uma vez: primeiro num .tmp ao lado (com fsync, para o ficheiro ir mesmo a disco), depois troca
    (um corte de luz não deixa meio ficheiro nem um .tmp por gravar)."""
    caminho = Path(caminho)
    tmp = caminho.with_name(caminho.name + '.tmp')
    with open(tmp, 'wb') as f:
        f.write(dados)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, caminho)


def _numeros_versoes(pasta):
    """Os números das vNNNN que existem (legíveis ou não), do maior para o menor."""
    return sorted((int(m.group(1)) for f in pasta.glob('v*.json.gz') if (m := re.fullmatch(r'v(\d+)\.json\.gz', f.name))),
                  reverse=True)


def proxima_versao(pasta):
    """A maior vNNNN que já existe + 1 (as versões nunca se apagam nem se reescrevem)."""
    recente = versao_mais_recente(pasta)
    return f'v{(int(recente[1:]) if recente else 0) + 1:04d}'


def versao_atual(pasta):
    f = pasta / 'atual'
    return f.read_text(encoding='utf-8').strip() if f.exists() else None


def versao_mais_recente(pasta):
    """A maior vNNNN que já existe (legível ou não, aceite ou não), ou None se não houver nenhuma."""
    numeros = _numeros_versoes(pasta)
    return f'v{numeros[0]:04d}' if numeros else None


def carregar(pasta, versao):
    return json.loads(gzip.decompress((pasta / f'{versao}.json.gz').read_bytes()).decode('utf-8'))


def carregar_seguro(pasta, versao):
    """Como `carregar`, mas devolve None em vez de rebentar com uma versão corrompida (p.ex. ficheiro vazio
    por um corte de luz a meio da escrita). Nunca apaga nem sobrescreve o ficheiro ilegível."""
    try:
        return carregar(pasta, versao)
    except Exception:
        return None


def versao_legivel_mais_recente(pasta):
    """A versão mais recente que se consiga mesmo ler, saltando as corrompidas (sem lhes tocar).
    None se não houver nenhuma versão legível."""
    for n in _numeros_versoes(pasta):
        modelo = carregar_seguro(pasta, f'v{n:04d}')
        if modelo is not None:
            return modelo
    return None


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
    # teste: a última saída; se tiver menos de 1 h, juntam-se as anteriores (a mais recente primeiro),
    # deixando sempre pelo menos uma para o treino
    k = 1
    while k < len(sess) - 1 and linhas['sessao'].isin(sess[-k:]).sum() < LINHAS_TESTE_MINIMAS:
        k += 1
    no_teste = linhas['sessao'].isin(sess[-k:])
    teste = linhas[no_teste]
    treino = linhas[~no_teste]
    ultima_saida = linhas.loc[linhas['sessao'] == sess[-1], 't'].min()  # a guarda é sempre a saída mais recente
    pasta = Path(pasta_modelos, nome)
    pasta.mkdir(parents=True, exist_ok=True)
    atual = versao_atual(pasta)
    # se a versão apontada por "atual" estiver ilegível (corrompida), conta como se não houvesse modelo em uso:
    # nunca apaga nem sobrescreve o ficheiro, só deixa de o usar como referência
    em_uso = carregar_seguro(pasta, atual) if atual else None
    # idem para a versão mais recente: salta as ilegíveis em vez de rebentar, sem lhes tocar
    recente = versao_legivel_mais_recente(pasta)
    # a última versão gravada e legível (mesmo rejeitada) já foi testada com esta saída: repetir dava a mesma versão outra vez
    referencia = recente if recente is not None and recente.get('ultimaSaida') else em_uso
    if referencia is not None and referencia.get('ultimaSaida') and pd.Timestamp(referencia['ultimaSaida']) >= ultima_saida:
        return {**res, 'motivo': 'sem saída nova para testar desde a última versão'}
    if len(teste) < LINHAS_TESTE_MINIMAS:
        return {**res, 'motivo': 'saída de teste curta (<1 h)'}
    x_tr, x_te = treino[spec['variaveis']], teste[spec['variaveis']]
    novo = treinar_quantis(x_tr, treino[spec['alvo']])
    mae_novo = mae(novo['p50'].predict(x_te), teste[spec['alvo']])
    mae_base = mae(spec['base'](teste, polar), teste[spec['alvo']])
    mae_atual = mae(prever_guardado(em_uso, teste), teste[spec['alvo']]) if em_uso is not None else None
    aceite = mae_novo <= mae_atual if em_uso is not None else mae_novo < mae_base
    final = treinar_quantis(linhas[spec['variaveis']], linhas[spec['alvo']]) if aceite else novo
    versao = proxima_versao(pasta)
    modelo = {
        'modelo': nome, 'versao': versao, 'criado': agora.isoformat(), 'alvo': spec['alvo'],
        'variaveis': spec['variaveis'], 'horas': res['horas'], 'n': res['n'], 'sessoes': len(sess),
        'ultimaSaida': ultima_saida.isoformat(), 'nTeste': int(len(teste)),
        'mae': round(mae_novo, 4), 'maeAtual': None if mae_atual is None else round(mae_atual, 4),
        'maeBase': round(mae_base, 4), 'aceite': aceite,
        'quantis': {q: b.dump_model() for q, b in final.items()},
        'nativo': {q: b.model_to_string() for q, b in final.items()},
        'celulas': celulas(linhas) if nome == 'velocidade' else None,
        'frases': frases(nome, linhas, linhas[spec['variaveis']], final['p50'], polar),
    }
    escrever(pasta / f'{versao}.json.gz', gzip.compress(json.dumps(modelo).encode('utf-8')))
    if aceite:
        escrever(pasta / 'atual', versao.encode('utf-8'))
    comparado = 'a versão em uso' if em_uso is not None else spec['origem']
    motivo = f'erra menos do que {comparado}' if aceite else f'erra mais do que {comparado}'
    return {**res, 'versao': versao, 'aceite': aceite, 'motivo': motivo, 'nTeste': modelo['nTeste'], 'mae': modelo['mae'],
            'maeAtual': modelo['maeAtual'], 'maeBase': modelo['maeBase'], 'frases': modelo['frases']}


MARGEM_ANTES = pd.Timedelta(hours=3)  # antes de cada saída, para a tendência da pressão e o balanço


def dias_das_saidas(saidas):
    """Os dias (UTC, 'AAAA-MM-DD') que cada saída toca, desde 3 h antes do início até ao fim."""
    dias = set()
    for ini, fim in saidas:
        dias.update(pd.date_range((ini - MARGEM_ANTES).floor('D'), fim.floor('D'), freq='D').strftime('%Y-%m-%d'))
    return dias


def so_perto_das_saidas(df, saidas):
    """Só as linhas entre 3 h antes do início e o fim de alguma saída: o Pi fica ligado no porto
    (8640 linhas por dia) e isso não pode fazer o treino crescer com o calendário."""
    dentro = pd.Series(False, index=df.index)
    for ini, fim in saidas:
        dentro |= (df['t'] >= ini - MARGEM_ANTES) & (df['t'] <= fim)
    return df[dentro]


def gravar_registo(pasta_modelos, resultados):
    """Acrescenta ao registo.json. Ilegível (ou sem ser uma lista) fica como está: não se apaga o histórico."""
    registo = pasta_modelos / 'registo.json'
    try:
        antigo = json.loads(registo.read_text(encoding='utf-8')) if registo.exists() else []
        if not isinstance(antigo, list):
            raise ValueError('não é uma lista')
    except Exception as e:
        print(f'aviso: registo.json ilegível ({e}); não foi alterado', file=sys.stderr)
        return
    escrever(registo, json.dumps(antigo + resultados, ensure_ascii=False, indent=1).encode('utf-8'))


def treinar(base, polar, agora=None, incluir_simulado=False, modelos=None):
    """Treina todos os modelos com os dados de `base` (a pasta da caixa negra) e devolve o resumo."""
    agora = agora or pd.Timestamp.now(tz='UTC')
    pasta_modelos = Path(base, 'modelos')
    pasta_modelos.mkdir(parents=True, exist_ok=True)
    saidas = ler_saidas(base)
    if not saidas:  # sem saídas não há como separar treino e teste (nem se inventam sessões pelos buracos)
        resultados = [{'modelo': n, 'data': agora.isoformat(), 'horas': 0.0, 'n': 0, 'versao': None, 'aceite': False,
                       'motivo': 'sem saídas gravadas'} for n in (modelos or MODELOS)]
        gravar_registo(pasta_modelos, resultados)
        return resultados
    df = so_perto_das_saidas(ler_tabela(base, dias_das_saidas(saidas)), saidas)
    if not incluir_simulado:
        df = df[df['simulado'] == 0]  # em branco (NaN) também não ensina
    d = preparar(df.reset_index(drop=True), saidas, ler_previsoes(base))  # o balanço usa também as linhas não estáveis
    d = d[d['estavel'] == 1].reset_index(drop=True)
    resultados = []
    for n in (modelos or MODELOS):
        try:
            resultados.append(treinar_um(n, d, pasta_modelos, agora, polar))
        except Exception as e:  # um modelo estragado não pára os outros
            print(traceback.format_exc(), file=sys.stderr)
            resultados.append({'modelo': n, 'data': agora.isoformat(), 'horas': None, 'n': None,
                               'versao': None, 'aceite': False, 'motivo': f'erro: {e}'})
    gravar_registo(pasta_modelos, resultados)
    return resultados
