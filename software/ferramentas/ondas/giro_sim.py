# Segunda parte do ensaio: vale a pena gravar também a rotação (giroscópio)?
# Compara a correção "sensor -> meio do barco" feita com a inclinação do chip (erro lento de
# 1 ou 2 graus) com a mesma correção feita com a rotação gravada, integrada na banda das ondas.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import ondas_sim as o
sys.stdout.reconfigure(encoding='utf-8')
G, FS, N, T = o.G, o.FS, o.N, o.T
F1, F2 = o.F1, o.F2

def d1(x):
    return np.fft.irfft(1j * 2 * np.pi * o.FREQS * np.fft.rfft(x), N)

def partes(x, fs):
    """Divide em parte lenta (abaixo da banda das ondas, com a média) e parte na banda."""
    n = x.size; f = np.fft.rfftfreq(n, 1 / fs); X = np.fft.rfft(x)
    L = np.where(f < F1, X, 0); B = np.where((f >= F1) & (f <= F2), X, 0)
    return np.fft.irfft(L, n), np.fft.irfft(B, n)

def integrar1(x, fs):
    n = x.size; f = np.fft.rfftfreq(n, 1 / fs); X = np.fft.rfft(x - x.mean())
    m = (f >= F1) & (f <= F2); Y = np.zeros_like(X); Y[m] = X[m] / (1j * 2 * np.pi * f[m])
    return np.fft.irfft(Y, n)

def corrida(hs, tp, seed, motor_hz=None, adorno=18.0, r=(-3.5, 0.8, 0.3), desvio=0.03, erro_graus=1.0, giro_desvio=0.1):
    rng = np.random.default_rng(seed)
    k = min(1.0, hs / 1.5)
    h_cg = o.serie(o.jonswap(tp), hs / 4, rng)
    theta = np.radians(o.serie(o.jonswap(tp), 3.0 * k, rng))
    phi = np.radians(adorno + o.serie(o.jonswap(max(3.5, 0.6 * tp), 1.0), 4.0 * k, rng))
    ax_h = o.serie(o.jonswap(tp), 0.3 * k, rng); ay_h = o.serie(o.jonswap(tp), 0.3 * k, rng)
    x, y, z = r
    st, ct, sp, cp = np.sin(theta), np.cos(theta), np.sin(phi), np.cos(phi)
    rr_x = ct * x + st * sp * y + st * cp * z; rr_y = cp * y - sp * z; rr_z = -st * x + ct * sp * y + ct * cp * z
    gx = ax_h + o.d2(rr_x); gy = ay_h + o.d2(rr_y); gz = -o.d2(h_cg) + o.d2(rr_z) - G
    f = np.stack([ct * gx - st * gz, st * sp * gx + cp * gy + ct * sp * gz, st * cp * gx - sp * gy + ct * cp * gz])
    f += rng.normal(0, 1, 3)[:, None] * desvio
    f += rng.normal(0, 190e-6 * G * np.sqrt(FS / 2), (3, N))
    dphi, dtheta = d1(phi), d1(theta)
    w = np.stack([dphi, dtheta * cp, -dtheta * sp])                       # rotação sentida pelo sensor (sem guinada)
    w += np.radians(rng.normal(0, 1, 3))[:, None] * giro_desvio           # desvio fixo do giroscópio (graus/s)
    w += np.radians(rng.normal(0, 0.014 * np.sqrt(FS / 2), (3, N)))       # ruído do giroscópio
    if motor_hz:
        vib = 1.0 * np.sin(2 * np.pi * motor_hz * T + 0.3) + 1.5 * np.sin(2 * np.pi * 1.5 * motor_hz * T + 1.1)
        f += np.array([0.3, 0.6, 1.0])[:, None] * vib
        w += np.radians(2.0) * np.array([1.0, 0.5, 0.3])[:, None] * np.sin(2 * np.pi * motor_hz * T + 0.7)
    lento = lambda: np.radians(o.serie(lambda q: np.exp(-(q / 0.1) ** 2), 1.0, rng)) * erro_graus
    phi_e, theta_e = phi + lento(), theta + lento()
    idx = np.arange(0, N, 10); n = (idx.size // 10) * 10
    med = lambda v: v[..., idx][..., :n].reshape(*v.shape[:-1], -1, 10).mean(-1)
    s, g, p, q = med(f), med(w), med(phi_e), med(theta_e); fs = 10.0
    # altura do sensor: a conta do desenho
    a_baixo = -np.sin(q) * s[0] + np.cos(q) * np.sin(p) * s[1] + np.cos(q) * np.cos(p) * s[2] + G
    h_s = o.banda(-a_baixo, fs, integrar2=True)
    braco = lambda pp, qq: -np.sin(qq) * x + np.cos(qq) * np.sin(pp) * y + np.cos(qq) * np.cos(pp) * z
    # 1) correção com a inclinação do chip
    h_cg_chip = o.banda(h_s + braco(p, q), fs)
    # 2) correção com a rotação gravada: parte lenta do chip + parte das ondas integrada do giroscópio
    dth = g[1] * np.cos(p) - g[2] * np.sin(p)
    dph = g[0] + (g[1] * np.sin(p) + g[2] * np.cos(p)) * np.tan(q)
    p_l, _ = partes(p, fs); q_l, _ = partes(q, fs)
    p_g, q_g = p_l + integrar1(dph, fs), q_l + integrar1(dth, fs)
    h_cg_giro = o.banda(h_s + braco(p_g, q_g), fs)
    # e a altura do sensor refeita com essa inclinação melhorada
    a2 = -np.sin(q_g) * s[0] + np.cos(q_g) * np.sin(p_g) * s[1] + np.cos(q_g) * np.cos(p_g) * s[2] + G
    h_s_giro = o.banda(-a2, fs, integrar2=True)
    v_cg = o.banda(h_cg, FS); v_s = o.banda(h_cg - rr_z, FS)
    return dict(v_cg=4 * v_cg.std(), v_s=4 * v_s.std(), s=4 * h_s.std(), s_giro=4 * h_s_giro.std(),
                cg_chip=4 * h_cg_chip.std(), cg_giro=4 * h_cg_giro.std(),
                tp=o.periodo_pico(v_cg, FS), tp_chip=o.periodo_pico(h_cg_chip, fs), tp_giro=o.periodo_pico(h_cg_giro, fs))

if __name__ == '__main__':
    mares = [(0.02, 8.0), (0.3, 3.0), (0.4, 14.0), (0.8, 4.0), (1.5, 9.0), (2.5, 11.0)]
    for titulo, kw in [('erro do chip 1 grau', {}), ('erro do chip 2 graus', dict(erro_graus=2.0)),
                       ('erro do chip 2 graus e giroscópio com desvio de 0,5 graus/s', dict(erro_graus=2.0, giro_desvio=0.5))]:
        print(f'\n== {titulo} ==')
        print('mar (Hs, Tp)   motor  | verdade: meio  Tp | meio c/ chip   Tp | meio c/ rotação gravada   Tp | sensor: verdade  conta  conta c/ rotação')
        for hs, tp in mares:
            for mh in (None, 40.1):
                L = [corrida(hs, tp, sd, mh, **kw) for sd in (1, 2, 3)]
                m = {k: float(np.mean([l[k] for l in L])) for k in L[0]}
                print(f"{hs:>4.2f} m {tp:>4.1f} s  {str(mh) if mh else 'parado':>6} | {m['v_cg']:>12.2f} {m['tp']:>5.1f} |"
                      f" {m['cg_chip']:>11.2f} {m['tp_chip']:>5.1f} | {m['cg_giro']:>22.2f} {m['tp_giro']:>5.1f} |"
                      f" {m['v_s']:>14.2f} {m['s']:>6.2f} {m['s_giro']:>8.2f}", flush=True)
