"""python -m arlequin_ia treinar --dados PASTA [--barco] [--polar CSV] [--agora ISO] [--incluir-simulado] [--modelo NOME]
Escreve no stdout uma linha JSON por modelo (o plugin da AI lê-as).
--barco: o treino do Pi (o plugin da AI passa-o): versões vNNNN, que entram em uso. Sem ele (à mão, no portátil) as
versões são pNNNN: não mexem no "atual" nem no registo.json que vêm do barco e só vão para o Pi por cópia confirmada
(decisão n.º 26)."""

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

from .base import ler_polar
from .treino import BARCO, MODELOS, PORTATIL, treinar

POLAR = Path(__file__).resolve().parents[2] / 'arlequin-ecra' / 'public' / 'polar-arlequin.csv'  # a mesma polar do ecrã


def main(argv=None):
    ap = argparse.ArgumentParser(prog='arlequin_ia')
    sub = ap.add_subparsers(dest='comando', required=True)
    t = sub.add_parser('treinar')
    t.add_argument('--dados', required=True)
    t.add_argument('--barco', action='store_true',
                   help='treino no Pi (o plugin da AI passa-o): versões vNNNN; sem isto, no portátil, pNNNN')
    t.add_argument('--polar', default=str(POLAR))
    t.add_argument('--agora')
    t.add_argument('--incluir-simulado', action='store_true', help='só para testes e demonstrações')
    t.add_argument('--modelo', action='append', choices=list(MODELOS))
    a = ap.parse_args(argv)
    sys.stdout.reconfigure(encoding='utf-8')  # o plugin lê UTF-8 (no Windows o padrão é outro)
    agora = pd.Timestamp(a.agora) if a.agora else None
    prefixo = BARCO if a.barco else PORTATIL
    for r in treinar(a.dados, ler_polar(a.polar), agora=agora, incluir_simulado=a.incluir_simulado, modelos=a.modelo,
                     prefixo=prefixo):
        print(json.dumps(r, ensure_ascii=False), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
