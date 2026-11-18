# Analisa uma gravação da caixa negra: resumo por marca e por radar.
#   python -I tools/analisar.py gravacoes/rec_xxx.txt
import sys, math, collections

YAW = [0.0, -120.0, 120.0]
NOMES = ["FRENTE", "T-ESQ", "T-DIR"]
lines = open(sys.argv[1], encoding="utf-8").read().splitlines()

segs = []  # (marca, t0, registos)
cur = {"m": 0, "t0": None, "R": [], "I": []}
for l in lines:
    p = l.split(",")
    if p[0] == "S":
        cur["t0"] = int(p[1])
    elif p[0] == "M":
        segs.append(cur)
        cur = {"m": int(p[2]), "t0": int(p[1]), "R": [], "I": []}
    elif p[0] == "R":
        t, r, n = int(p[1]), int(p[2]), int(p[3])
        pts = [(int(p[4 + 2 * k]) / 10, int(p[5 + 2 * k]) / 10) for k in range(n)]
        cur["R"].append((t, r, pts))
    elif p[0] == "I":
        cur["I"].append((int(p[1]), float(p[2]), int(p[3]), float(p[4]), int(p[5])))
segs.append(cur)

def world(r, x, y):
    d = math.hypot(x, y)
    b = YAW[r] + math.degrees(math.atan2(x, y))
    b = (b + 180) % 360 - 180
    return b, d

for s in segs:
    if not s["R"]:
        continue
    t0, t1 = s["R"][0][0], s["R"][-1][0]
    st = sum(i[2] for i in s["I"]) / max(1, len(s["I"]))
    mv = sum(i[3] for i in s["I"]) / max(1, len(s["I"]))
    h = [i[1] for i in s["I"]]
    print(f"\n===== MARCA {s['m']}  ({(t1 - t0) / 1000:.0f} s)  parado {st:.0%}  mexer {mv:.1f}  rumo {min(h, default=0):.0f}..{max(h, default=0):.0f}")
    for r in range(3):
        fr = [x for x in s["R"] if x[1] == r]
        if not fr:
            continue
        cnt = collections.Counter(len(x[2]) for x in fr)
        # zonas onde aparecem alvos (rumo de 20 em 20 graus, distância de 1 em 1 m)
        cells = collections.Counter()
        for _, _, pts in fr:
            for (x, y) in pts:
                b, d = world(r, x, y)
                cells[(int(round(b / 20) * 20), round(d))] += 1
        top = ", ".join(f"{b:+d}°/{d}m:{c * 100 // len(fr)}%" for (b, d), c in cells.most_common(5))
        dist = " ".join(f"{k}:{v * 100 // len(fr)}%" for k, v in sorted(cnt.items()))
        print(f"  {NOMES[r]:6} {len(fr) / max(1, (t1 - t0) / 1000):.0f}/s  n.º alvos [{dist}]  onde: {top}")
