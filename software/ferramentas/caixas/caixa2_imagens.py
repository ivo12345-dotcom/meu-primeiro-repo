# Tira as imagens da base da caixa 2 a partir das peças soltas que o caixa2_base.py escreve.
#
#   python caixa2_imagens.py <pasta das peças soltas> <pasta de saída>
#
# Precisa do vtk. As placas aparecem só para se ver o conjunto; não se imprimem.
import os
import sys

import caixa1_imagens as c1

c1.CORES.update({'mod_pcb': (0.10, 0.22, 0.60), 'mod_cima': (0.18, 0.18, 0.20), 'mod_baixo': (0.80, 0.12, 0.10)})
PLACAS = ['esp_pcb', 'esp_baixo', 'esp_reguas', 'esp_usb', 'mod_pcb', 'mod_cima', 'mod_baixo']


def main():
    pecas, saida = sys.argv[1], sys.argv[2]
    os.makedirs(saida, exist_ok=True)

    def conjunto():
        cabo = c1.tubo([(84.0, 9.0, 7.4), (92.0, 9.0, 7.4), (130.0, 9.0, 7.4)], 2.2, (0.30, 0.31, 0.33))
        return [c1.ator(pecas, n) for n in ['base'] + PLACAS] + [cabo]

    # 1. o conjunto montado, visto do lado da plaquinha
    c1.imagem(os.path.join(saida, 'caixa2-conjunto.png'), conjunto(), olho=(40, -190, 150), alvo=(60, 0, 6), altura=1000)
    # 2. só a base, como sai da impressora
    c1.imagem(os.path.join(saida, 'caixa2-base.png'), [c1.ator(pecas, 'base')], olho=(40, -190, 150), alvo=(60, 0, 6), altura=1000)
    # 3. por cima, para se ver onde fica cada coisa
    c1.imagem(os.path.join(saida, 'caixa2-por-cima.png'), conjunto(), olho=(60, -1, 330), alvo=(60, 0, 0), altura=900, angulo=26, cima=(0, 1, 0))
    # 4. a ponta dos cabos, de perto: a plaquinha, a ponte, o berço e as passagens
    c1.imagem(os.path.join(saida, 'caixa2-ponta.png'), conjunto(), olho=(170, -95, 80), alvo=(80, -4, 8), angulo=26)


if __name__ == '__main__':
    main()
