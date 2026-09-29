"""python -m arlequin_ia treinar --dados PASTA [--polar CSV] [--agora ISO] [--incluir-simulado] [--modelo NOME]
Escreve no stdout uma linha JSON por modelo (o plugin da AI lê-as)."""

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

from .base import ler_polar
from .treino import MODELOS, treinar

POLAR = Path(__file__).resolve().parents[2] / 'arlequin-ecra' / 'public' / 'polar-arlequin.csv'  # a mesma polar do ecrã


def main(argv=None):
    ap = argparse.ArgumentParser(prog='arlequin_ia')
    sub = ap.add_subparsers(dest='comando', required=True)
    t = sub.add_parser('treinar')
    t.add_argument('--dados', required=True)
    t.add_argument('--polar', default=str(POLAR))
    t.add_argument('--agora')
    t.add_argument('--incluir-simulado', action='store_true', help='só para testes e demonstrações')
    t.add_argument('--modelo', action='append', choices=list(MODELOS))
    a = ap.parse_args(argv)
    sys.stdout.reconfigure(encoding='utf-8')  # o plugin lê UTF-8 (no Windows o padrão é outro)
    agora = pd.Timestamp(a.agora) if a.agora else None
    for r in treinar(a.dados, ler_polar(a.polar), agora=agora, incluir_simulado=a.incluir_simulado, modelos=a.modelo):
        print(json.dumps(r, ensure_ascii=False), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
