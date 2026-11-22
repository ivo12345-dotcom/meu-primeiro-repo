# Ensaio do desenho "sobe e desce" (docs/superpowers/specs/2026-11-20-sistema-no-portatil-design.md):
# o que a caixa 1 manda (10 leituras/s) chega para, depois, tirar a altura e o período da onda?
# Simula o movimento do barco, o sensor à popa e fora do eixo, o adornamento, o erro do chip, o
# ruído e a vibração do motor, e compara maneiras de ler o sensor:
#   A  sensor lido 100 vezes/s, média de 10 -> 10 leituras/s (o desenho)
#   B  10 leituras/s diretas, sem média
#   C  sensor lido 50 vezes/s, média de 5 -> 10 leituras/s
#   D  sensor lido 100 vezes/s, média de 20 -> 5 leituras/s
#   "sem inclinação": a conta só com o eixo "de cima" do sensor
# "meio" é a altura no meio do barco; "sensor", a altura no sítio do sensor. Alturas significativas
# (4 x desvio-padrão) na banda de 25 s a 1 s.
#
#   python ondas_sim.py          (uns 2 minutos; precisa do numpy)
#   python ondas_sim.py rapido   (dois casos, para ver se corre)
#
# A segunda parte (vale a pena gravar a rotação?) está no giro_sim.py; o espaço que ocupa na caixa
# negra mede-se com o tamanho.js. Os resultados de 21/11/2026 estão no resultado-2026-11-21.txt.
import sys
import numpy as np
sys.stdout.reconfigure(encoding='utf-8')

G = 9.80665
FS, DUR = 1000, 1200            # "verdade" a 1000 Hz, 20 minutos
N = FS * DUR
T = np.arange(N) / FS
FREQS = np.fft.rfftfreq(N, 1 / FS)
F1, F2 = 0.04, 1.0              # banda das ondas: 25 s a 1 s


def serie(forma, rms, rng):
    """Série aleatória (periódica) com a forma de espetro dada e o rms pedido."""
    S = np.zeros_like(FREQS)
    m = (FREQS > 0.02) & (FREQS < 2.0)
    S[m] = forma(FREQS[m])
    X = np.sqrt(S) * np.exp(1j * rng.uniform(0, 2 * np.pi, FREQS.size))
    x = np.fft.irfft(X, N)
    return x * (rms / x.std())


def jonswap(tp, gamma=3.3):
    fp = 1 / tp

    def S(f):
        s = np.where(f <= fp, 0.07, 0.09)
        return f ** -5.0 * np.exp(-1.25 * (fp / f) ** 4) * gamma ** np.exp(-((f - fp) ** 2) / (2 * s * s * fp * fp))
    return S


def d2(x):
    """Segunda derivada exata de uma série periódica."""
    return np.fft.irfft(-(2 * np.pi * FREQS) ** 2 * np.fft.rfft(x), N)


def banda(x, fs, integrar2=False):
    """Fica só com a banda das ondas; com integrar2, passa de aceleração a altura."""
    n = x.size
    f = np.fft.rfftfreq(n, 1 / fs)
    X = np.fft.rfft(x - x.mean())
    m = (f >= F1) & (f <= F2)
    Y = np.zeros_like(X)
    Y[m] = -X[m] / (2 * np.pi * f[m]) ** 2 if integrar2 else X[m]
    return np.fft.irfft(Y, n)


def periodo_pico(h, fs):
    f = np.fft.rfftfreq(h.size, 1 / fs)
    P = np.abs(np.fft.rfft(h)) ** 2
    k = max(3, int(0.012 / (f[1] - f[0])))
    Ps = np.convolve(P, np.ones(k) / k, 'same')
    m = (f >= F1) & (f <= F2)
    return 1 / f[m][np.argmax(Ps[m])]


def cenario(hs, tp, seed, motor_hz=None, adorno=18.0, r=(-3.5, 0.8, 0.3), desvio=0.03, erro_graus=1.0):
    rng = np.random.default_rng(seed)
    k = min(1.0, hs / 1.5)
    h_cg = serie(jonswap(tp), hs / 4, rng)                                  # altura do meio do barco (para cima)
    theta = np.radians(serie(jonswap(tp), 3.0 * k, rng))                    # caimento
    phi = np.radians(adorno + serie(jonswap(max(3.5, 0.6 * tp), 1.0), 4.0 * k, rng))  # adornamento + balanço
    ax_h = serie(jonswap(tp), 0.3 * k, rng)                                 # acelerações horizontais do barco
    ay_h = serie(jonswap(tp), 0.3 * k, rng)
    x, y, z = r                                                             # sensor: x p/ vante, y p/ estibordo, z p/ baixo
    st, ct, sp, cp = np.sin(theta), np.cos(theta), np.sin(phi), np.cos(phi)
    rr_x = ct * x + st * sp * y + st * cp * z
    rr_y = cp * y - sp * z
    rr_z = -st * x + ct * sp * y + ct * cp * z
    h_s = h_cg - rr_z                                                       # altura do sensor
    gx = ax_h + d2(rr_x)
    gy = ay_h + d2(rr_y)
    gz = -d2(h_cg) + d2(rr_z) - G                                           # a - g, com z para baixo
    f = np.stack([ct * gx - st * gz,
                  st * sp * gx + cp * gy + ct * sp * gz,
                  st * cp * gx - sp * gy + ct * cp * gz])                   # o que o acelerómetro sente
    f += rng.normal(0, 1, 3)[:, None] * desvio                              # desvio fixo de cada eixo
    f += rng.normal(0, 190e-6 * G * np.sqrt(FS / 2), (3, N))                # ruído do chip
    if motor_hz:
        vib = 1.0 * np.sin(2 * np.pi * motor_hz * T + 0.3) + 1.5 * np.sin(2 * np.pi * 1.5 * motor_hz * T + 1.1)
        f += np.array([0.3, 0.6, 1.0])[:, None] * vib

    def lento():
        return np.radians(serie(lambda q: np.exp(-(q / 0.1) ** 2), 1.0, rng)) * erro_graus  # erro lento do chip
    phi_e, theta_e = phi + lento(), theta + lento()

    def ler(passo, media):
        """O sensor dá uma leitura instantânea de 'passo' em 'passo' ms; a caixa faz a média de 'media' leituras."""
        idx = np.arange(0, N, passo)
        n = (idx.size // media) * media
        s = f[:, idx][:, :n].reshape(3, -1, media).mean(2)
        p = phi_e[idx][:n].reshape(-1, media).mean(1)
        q = theta_e[idx][:n].reshape(-1, media).mean(1)
        return s, p, q, FS / (passo * media)

    def conta(leitura, compensar=True, braco=None):
        s, p, q, fs = leitura
        if compensar:
            a_baixo = -np.sin(q) * s[0] + np.cos(q) * np.sin(p) * s[1] + np.cos(q) * np.cos(p) * s[2] + G
        else:
            a_baixo = s[2] + G                                              # só o eixo "vertical" do sensor
        h = banda(-a_baixo, fs, integrar2=True)
        if braco:
            bx, by, bz = braco
            h = banda(h - np.sin(q) * bx + np.cos(q) * np.sin(p) * by + np.cos(q) * np.cos(p) * bz, fs)
        return h, fs

    hs_de = lambda hf: 4 * hf[0].std()
    verdade_s = banda(h_s, FS)
    verdade_cg = banda(h_cg, FS)
    a = ler(10, 10)        # desenho: sensor a 100/s, média de 10 -> 10/s
    b = ler(100, 1)        # 10/s direto, sem média
    c = ler(20, 5)         # sensor a 50/s, média de 5 -> 10/s
    d = ler(10, 20)        # sensor a 100/s, média de 20 -> 5/s
    return {
        'hs_cg': 4 * verdade_cg.std(), 'hs_s': 4 * verdade_s.std(), 'tp': periodo_pico(verdade_cg, FS),
        'A_s': hs_de(conta(a)), 'A_cg': hs_de(conta(a, braco=r)), 'A_tp': periodo_pico(*conta(a, braco=r)),
        'A_cg_braco_errado': hs_de(conta(a, braco=(r[0] + 0.5, r[1] - 0.3, r[2]))),
        'B_s': hs_de(conta(b)), 'C_s': hs_de(conta(c)), 'D_s': hs_de(conta(d)),
        'A_s_sem_inclinacao': hs_de(conta(a, compensar=False)),
    }


def tabela(titulo, mares, motores, sementes, **kw):
    print()
    print(f'== {titulo} ==')
    print('mar (Hs, Tp)   motor  | verdade: meio sensor   Tp | A: sensor   meio    Tp | B: 10/s direto | C: 50->10 | D: 100->5 | sem inclinação')
    piores = {}
    for hs, tp in mares:
        for mh in motores:
            linhas = [cenario(hs, tp, s_, mh, **kw) for s_ in sementes]
            m = {k: float(np.mean([l[k] for l in linhas])) for k in linhas[0]}
            for k, ref in (('A_s', 'hs_s'), ('A_cg', 'hs_cg'), ('A_cg_braco_errado', 'hs_cg'), ('B_s', 'hs_s'), ('C_s', 'hs_s'), ('D_s', 'hs_s'), ('A_s_sem_inclinacao', 'hs_s')):
                piores[k] = max(piores.get(k, 0), max(abs(l[k] - l[ref]) / l[ref] * 100 for l in linhas))
            piores['A_tp_s'] = max(piores.get('A_tp_s', 0), max(abs(l['A_tp'] - l['tp']) for l in linhas))
            print(f"{hs:>4.2f} m {tp:>4.1f} s  {str(mh) if mh else 'parado':>6} |"
                  f" {m['hs_cg']:>12.2f} {m['hs_s']:>6.2f} {m['tp']:>5.1f} |"
                  f" {m['A_s']:>9.2f} {m['A_cg']:>6.2f} {m['A_tp']:>5.1f} |"
                  f" {m['B_s']:>13.2f}  | {m['C_s']:>8.2f}  | {m['D_s']:>8.2f}  | {m['A_s_sem_inclinacao']:>8.2f}", flush=True)
    print('Pior erro (% da altura verdadeira; A_tp_s em segundos): ' + '  '.join(f'{k}={v:.1f}' for k, v in piores.items()))


if __name__ == '__main__':
    mares = [(0.3, 3.0), (0.4, 14.0), (0.8, 4.0), (1.5, 9.0), (2.5, 11.0)]
    motores = [None, 26.7, 33.3, 40.1, 50.02, 59.9]
    if len(sys.argv) > 1 and sys.argv[1] == 'rapido':
        tabela('rápido', [(1.5, 9.0)], [None, 40.1], [1])
        sys.exit(0)
    tabela('Desenho: desvio calibrado na bancada (0,03 m/s2), erro do chip 1 grau', mares, motores, [1, 2, 3])
    tabela('Sem calibrar o acelerómetro (0,3 m/s2 por eixo)', mares, [None, 40.1], [1, 2, 3], desvio=0.3)
    tabela('Chip com 2 graus de erro de inclinação', mares, [None, 40.1], [1, 2, 3], erro_graus=2.0)
    tabela('Barco direito (sem adornamento), a motor', mares, [40.1], [1, 2, 3], adorno=0.0)
    tabela('Mar chão (0,02 m): o que a conta dá quando não há onda', [(0.02, 8.0)], [None, 40.1], [1, 2, 3])
