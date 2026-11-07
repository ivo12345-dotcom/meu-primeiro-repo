#!/usr/bin/env python3
"""
Procura de chaves para o "Bitcoin Puzzle" (desafio publico de 2015).

A chave privada do puzzle #n esta no intervalo [2^(n-1), 2^n - 1]. O script
gera chaves desse intervalo, calcula o endereco Bitcoin (chave publica
comprimida -> SHA256 -> RIPEMD160) e compara com o endereco do puzzle.

Usa apenas Python (sem dependencias). E educativo: e muito mais lento do que
ferramentas de GPU. Serve para perceber o processo e medir a velocidade.

Exemplos:
    python3 bitcoin_puzzle.py --teste                 # verifica o codigo
    python3 bitcoin_puzzle.py --puzzle 25             # resolve um puzzle ja resolvido
    python3 bitcoin_puzzle.py --puzzle 71 --benchmark 30
    python3 bitcoin_puzzle.py --puzzle 71             # procura aleatoria
    python3 bitcoin_puzzle.py --puzzle 71 --modo sequencial --inicio 0x500000000000000000
"""

import argparse
import hashlib
import json
import multiprocessing as mp
import os
import secrets
import sys
import time

# --------------------------------------------------------------------------
# Curva secp256k1
# --------------------------------------------------------------------------
P = 2**256 - 2**32 - 977
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (
    0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
    0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8,
)


def ec_add(a, b):
    """Soma de dois pontos em coordenadas afins (None = ponto no infinito)."""
    if a is None:
        return b
    if b is None:
        return a
    (x1, y1), (x2, y2) = a, b
    if x1 == x2:
        if (y1 + y2) % P == 0:
            return None
        lam = 3 * x1 * x1 * pow(2 * y1, -1, P) % P
    else:
        lam = (y2 - y1) * pow(x2 - x1, -1, P) % P
    x3 = (lam * lam - x1 - x2) % P
    return x3, (lam * (x1 - x3) - y1) % P


def ec_mul(k, pt=G):
    """Multiplicacao escalar k*pt (double-and-add)."""
    result = None
    while k:
        if k & 1:
            result = ec_add(result, pt)
        pt = ec_add(pt, pt)
        k >>= 1
    return result


# --------------------------------------------------------------------------
# Hashes e enderecos
# --------------------------------------------------------------------------
try:
    hashlib.new("ripemd160", b"")

    def _ripemd160(data):
        return hashlib.new("ripemd160", data).digest()
except ValueError:  # OpenSSL 3 sem o algoritmo "legacy"
    try:
        from Crypto.Hash import RIPEMD160  # pycryptodome

        def _ripemd160(data):
            return RIPEMD160.new(data).digest()
    except ImportError:
        sys.exit("Falta RIPEMD160 neste Python. Instale: pip install pycryptodome")

_sha256 = hashlib.sha256


def hash160(data):
    return _ripemd160(_sha256(data).digest())


def pubkey_comprimida(pt):
    x, y = pt
    return (b"\x03" if y & 1 else b"\x02") + x.to_bytes(32, "big")


B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58encode_check(payload):
    data = payload + _sha256(_sha256(payload).digest()).digest()[:4]
    n = int.from_bytes(data, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = B58[r] + out
    zeros = len(data) - len(data.lstrip(b"\x00"))
    return "1" * zeros + out


def b58decode_check(s):
    n = 0
    for c in s:
        n = n * 58 + B58.index(c)
    zeros = len(s) - len(s.lstrip("1"))
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    data = b"\x00" * zeros + raw
    payload, checksum = data[:-4], data[-4:]
    if _sha256(_sha256(payload).digest()).digest()[:4] != checksum:
        raise ValueError(f"Endereco invalido (checksum errado): {s}")
    return payload


def endereco_de_chave(k):
    return b58encode_check(b"\x00" + hash160(pubkey_comprimida(ec_mul(k))))


def hash160_de_endereco(addr):
    payload = b58decode_check(addr)
    if len(payload) != 21 or payload[0] != 0:
        raise ValueError(f"Nao e um endereco P2PKH: {addr}")
    return payload[1:]


def wif_comprimido(k):
    return b58encode_check(b"\x80" + k.to_bytes(32, "big") + b"\x01")


# --------------------------------------------------------------------------
# Dados dos puzzles
# --------------------------------------------------------------------------
# Puzzles em aberto (apenas o endereco e conhecido).
EM_ABERTO = {
    71: "1PWo3JeB9jrGwfHDNpdGK54CRas7fsVzXU",
}

# Puzzles ja resolvidos: (chave, endereco). Usados para testar o codigo.
RESOLVIDOS = {
    1: (0x1, "1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH"),
    2: (0x3, "1CUNEBjYrCn2y1SdiUMohaKUi4wpP326Lb"),
    3: (0x7, "19ZewH8Kk1PDbSNdJ97FP4EiCjTRaZMZQA"),
    4: (0x8, "1EhqbyUMvvs7BfL8goY6qcPbD6YKfPqb7e"),
    5: (0x15, "1E6NuFjCi27W5zoXg8TRdcSRq84zJeBW3k"),
    10: (0x202, "1LeBZP5QCwwgXRtmVUvTVrraqPUokyLHqe"),
    20: (0xD2C55, "1HsMJxNiV7TLxmoF6uJNkydxPFDog4NQum"),
    25: (0x1FA5EE5, "15JhYXn6Mx3oF4Y7PcTAv2wVVAuCFFQNiP"),
    30: (0x3D94CD64, "1LHtnpd8nU5VHEMkG2TMYYNUjjLc992bps"),
}


def endereco_do_puzzle(n):
    if n in EM_ABERTO:
        return EM_ABERTO[n]
    if n in RESOLVIDOS:
        return RESOLVIDOS[n][1]
    sys.exit(f"Nao conheco o endereco do puzzle #{n}. Use --endereco.")


# --------------------------------------------------------------------------
# Procura
# --------------------------------------------------------------------------
LOTE = 1024  # pontos calculados de cada vez (uma so inversao modular por lote)

_tabela = None  # _tabela[j] = (j+1)*G, partilhada por cada processo


def _iniciar_worker():
    global _tabela
    _tabela = [G]
    for _ in range(LOTE - 1):
        _tabela.append(ec_add(_tabela[-1], G))


def procurar_bloco(inicio, quantidade, alvo):
    """
    Testa as chaves inicio .. inicio+quantidade-1.
    Devolve a chave se encontrar, senao None.

    Truque: Q = inicio*G e calculado uma vez; depois os pontos seguintes sao
    Q + j*G (j = 1..LOTE), com todas as inversoes do lote feitas de uma vez
    (truque de Montgomery). Isto e muito mais rapido do que k*G para cada k.
    """
    if _tabela is None:
        _iniciar_worker()
    tabela = _tabela
    fim = inicio + quantidade
    Q = ec_mul(inicio)
    if hash160(pubkey_comprimida(Q)) == alvo:
        return inicio
    k = inicio
    while k + 1 < fim:
        qx, qy = Q
        dx = [(tx - qx) % P for tx, _ in tabela]
        if 0 in dx:  # so acontece com chaves muito pequenas: modo simples
            for j, T in enumerate(tabela):
                if k + j + 1 >= fim:
                    return None
                if hash160(pubkey_comprimida(ec_add(Q, T))) == alvo:
                    return k + j + 1
            Q = ec_add(Q, tabela[-1])
            k += LOTE
            continue

        # inversao em lote
        pref = []
        acc = 1
        for d in dx:
            acc = acc * d % P
            pref.append(acc)
        inv = pow(acc, -1, P)
        invs = [0] * LOTE
        for i in range(LOTE - 1, 0, -1):
            invs[i] = inv * pref[i - 1] % P
            inv = inv * dx[i] % P
        invs[0] = inv

        x3 = y3 = 0
        for i in range(LOTE):
            tx, ty = tabela[i]
            lam = (ty - qy) * invs[i] % P
            x3 = (lam * lam - qx - tx) % P
            y3 = (lam * (qx - x3) - qy) % P
            pub = (b"\x03" if y3 & 1 else b"\x02") + x3.to_bytes(32, "big")
            if _ripemd160(_sha256(pub).digest()) == alvo:
                chave = k + i + 1
                return chave if chave < fim else None
        Q = (x3, y3)  # = (k + LOTE) * G
        k += LOTE
    return None


def _tarefa(args):
    inicio, quantidade, alvo = args
    return inicio, quantidade, procurar_bloco(inicio, quantidade, alvo)


def formatar_tempo(seg):
    if seg < 120:
        return f"{seg:.0f} s"
    if seg < 7200:
        return f"{seg / 60:.0f} min"
    if seg < 172800:
        return f"{seg / 3600:.0f} h"
    anos = seg / (365.25 * 86400)
    if anos < 2:
        return f"{seg / 86400:.0f} dias"
    return f"{anos:,.0f} anos".replace(",", " ")


def guardar_resultado(chave, endereco, n):
    texto = (
        f"Puzzle #{n}\n"
        f"Endereco: {endereco}\n"
        f"Chave privada (hex): {chave:064x}\n"
        f"WIF (comprimido): {wif_comprimido(chave)}\n"
    )
    with open(f"ENCONTRADO_puzzle{n}.txt", "w") as f:
        f.write(texto)
    print("\n" + "=" * 70)
    print("CHAVE ENCONTRADA!")
    print(texto)
    print("Guardado em", f"ENCONTRADO_puzzle{n}.txt")
    if n in EM_ABERTO:
        print(
            "\nATENCAO: NAO envie a transacao pela rede publica (mempool).\n"
            "Ao gastar, a chave publica fica exposta e bots conseguem calcular\n"
            "a chave privada em segundos (Kangaroo) e roubar o premio com uma\n"
            "taxa maior. Envie a transacao diretamente a um minerador/pool que\n"
            "aceite transacoes privadas."
        )
    print("=" * 70)


def main():
    ap = argparse.ArgumentParser(description="Procura de chaves do Bitcoin Puzzle")
    ap.add_argument("--puzzle", type=int, default=71, help="numero do puzzle (padrao 71)")
    ap.add_argument("--endereco", help="endereco alvo (se o puzzle nao estiver na lista)")
    ap.add_argument("--modo", choices=["aleatorio", "sequencial"], default="aleatorio")
    ap.add_argument("--inicio", help="chave inicial em hex (modo sequencial)")
    ap.add_argument("--bloco", type=int, default=1 << 20, help="chaves por tarefa")
    ap.add_argument("--processos", type=int, default=os.cpu_count() or 1)
    ap.add_argument("--benchmark", type=float, metavar="SEG",
                    help="corre durante SEG segundos e mostra a estimativa de tempo")
    ap.add_argument("--teste", action="store_true", help="verifica o codigo com puzzles resolvidos")
    a = ap.parse_args()

    if a.teste:
        return correr_testes()

    n = a.puzzle
    endereco = a.endereco or endereco_do_puzzle(n)
    alvo = hash160_de_endereco(endereco)
    lo, hi = 1 << (n - 1), (1 << n) - 1
    if n == 1:
        lo = 1
    total = hi - lo + 1
    bloco = max(1, min(a.bloco, total))

    progresso_ficheiro = f"progresso_puzzle{n}.json"
    proximo = lo
    if a.modo == "sequencial":
        if a.inicio:
            proximo = int(a.inicio, 16)
        elif os.path.exists(progresso_ficheiro):
            with open(progresso_ficheiro) as f:
                proximo = int(json.load(f)["proximo"], 16)
            print(f"A retomar de {proximo:#x} ({progresso_ficheiro})")
        if not lo <= proximo <= hi:
            sys.exit(f"--inicio fora do intervalo [{lo:#x}, {hi:#x}]")

    print(f"Puzzle #{n}  endereco {endereco}")
    print(f"Intervalo: {lo:#x} .. {hi:#x}  ({total:.3e} chaves)")
    print(f"Modo: {a.modo}  processos: {a.processos}  bloco: {bloco}\n")

    def gerar_tarefas():
        nonlocal proximo
        while True:
            if a.modo == "aleatorio":
                inicio = lo + secrets.randbelow(max(1, total - bloco + 1))
                yield inicio, bloco
            else:
                if proximo > hi:
                    return
                q = min(bloco, hi - proximo + 1)
                yield proximo, q
                proximo += q

    testadas = 0
    t0 = time.time()
    ultimo_print = t0
    pendentes_seq = {}  # inicio -> fim, para guardar progresso contiguo
    seguro = proximo  # todas as chaves abaixo disto ja foram testadas
    tarefas = gerar_tarefas()
    encontrada = None

    with mp.Pool(a.processos, initializer=_iniciar_worker) as pool:
        emcurso = []

        def encher():
            while len(emcurso) < a.processos * 2:
                try:
                    inicio, q = next(tarefas)
                except StopIteration:
                    return
                pendentes_seq[inicio] = inicio + q
                emcurso.append(pool.apply_async(_tarefa, ((inicio, q, alvo),)))

        encher()
        try:
            while emcurso:
                pronto = [r for r in emcurso if r.ready()]
                if not pronto:
                    time.sleep(0.05)
                for r in pronto:
                    emcurso.remove(r)
                    inicio, q, chave = r.get()
                    testadas += q
                    if chave is not None:
                        encontrada = chave
                        break
                    if a.modo == "sequencial":
                        pendentes_seq[inicio] = -1  # concluido
                        while seguro in pendentes_seq and pendentes_seq[seguro] == -1:
                            del pendentes_seq[seguro]
                            seguro = min(seguro + bloco, hi + 1)
                    else:
                        pendentes_seq.pop(inicio, None)
                if encontrada is not None:
                    break

                agora = time.time()
                if agora - ultimo_print >= 5 or not emcurso:
                    vel = testadas / max(agora - t0, 1e-9)
                    falta = total / vel if vel else float("inf")
                    print(f"{testadas:,} chaves | {vel:,.0f} chaves/s | "
                          f"intervalo completo em ~{formatar_tempo(falta)}", flush=True)
                    ultimo_print = agora
                    if a.modo == "sequencial":
                        with open(progresso_ficheiro, "w") as f:
                            json.dump({"proximo": hex(seguro)}, f)

                if a.benchmark and agora - t0 >= a.benchmark:
                    break
                encher()
        except KeyboardInterrupt:
            print("\nInterrompido.")
        pool.terminate()

    if a.modo == "sequencial" and encontrada is None:
        with open(progresso_ficheiro, "w") as f:
            json.dump({"proximo": hex(seguro)}, f)
        print(f"Progresso guardado em {progresso_ficheiro} (proximo: {seguro:#x})")

    dur = time.time() - t0
    vel = testadas / max(dur, 1e-9)
    if encontrada is not None:
        assert endereco_de_chave(encontrada) == endereco
        guardar_resultado(encontrada, endereco, n)
    else:
        print(f"\nTestadas {testadas:,} chaves em {dur:.1f} s ({vel:,.0f} chaves/s).")
        print(f"Fracao do intervalo coberta: {testadas / total:.3e}")
        print(f"Tempo medio esperado ate encontrar (metade do intervalo): "
              f"~{formatar_tempo(total / 2 / vel)}")


def correr_testes():
    print("1) Chave -> endereco nos puzzles resolvidos")
    for n, (k, addr) in sorted(RESOLVIDOS.items()):
        ok = endereco_de_chave(k) == addr
        print(f"   #{n:<3} {'OK ' if ok else 'FALHOU'} {addr}")
        if not ok:
            sys.exit(1)
    for n, addr in EM_ABERTO.items():
        hash160_de_endereco(addr)  # valida checksum
        print(f"   #{n:<3} endereco valido {addr}")

    print("2) Procura em lote encontra a chave certa")
    _iniciar_worker()
    for n, (k, addr) in sorted(RESOLVIDOS.items()):
        if n > 25:
            continue
        lo = 1 if n == 1 else 1 << (n - 1)
        # bloco pequeno a volta da chave, para o teste ser rapido
        inicio = max(lo, k - 3000)
        achada = procurar_bloco(inicio, 6000, hash160_de_endereco(addr))
        ok = achada == k
        print(f"   #{n:<3} {'OK ' if ok else 'FALHOU'} {achada and hex(achada)}")
        if not ok:
            sys.exit(1)
    print("Todos os testes passaram.")


if __name__ == "__main__":
    main()
