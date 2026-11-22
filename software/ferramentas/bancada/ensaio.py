# Corre o ensaio de bancada 2 a partir do portátil: manda os ritmos à placa (programa bno085),
# guarda tudo o que ela diz e faz o resumo de cada ritmo.
#
#   python ensaio.py COM5 rapido      --saida <pasta>           5 ritmos, 1 minuto cada
#   python ensaio.py COM5 completo    --saida <pasta>           os mesmos, 5 minutos cada
#   python ensaio.py COM5 resistencia --saida <pasta> --horas 3 --ritmo 400000,400,400,100
#   python ensaio.py COM5 despejo     --saida <pasta> --segundos 20 --ritmo 400000,400,400,100
#
# Um ritmo é: velocidade do barramento (Hz), aceleração por segundo, rotação por segundo, atitude
# por segundo. Precisa do pyserial. Os registos ficam na pasta de saída (fora do repositório).
import argparse
import os
import statistics
import sys
import time

import serial

sys.stdout.reconfigure(encoding='utf-8')

RITMOS = [
    (100000, 100, 100, 100),   # o mínimo do desenho, com o barramento devagar
    (400000, 100, 100, 100),   # o mínimo do desenho
    (400000, 200, 200, 100),
    (400000, 400, 400, 100),   # o mais depressa que o sensor dá na rotação
    (400000, 500, 400, 100),   # o mais depressa que o sensor dá na aceleração
]


def campos(linha):
    """'E a=1 b=2.5' -> {'a': 1.0, 'b': 2.5}; o que não for número fica como texto."""
    d = {}
    for parte in linha.split()[1:]:
        if '=' not in parte:
            continue
        k, v = parte.split('=', 1)
        try:
            d[k] = float(v)
        except ValueError:
            d[k] = v
    return d


class Placa:
    def __init__(self, porta, registo):
        self.porta = porta
        self.registo = registo
        self.s = None
        self.resto = b''
        self.quedas = 0

    def abre(self):
        self.s = serial.Serial(self.porta, 921600, timeout=0.2)
        self.resto = b''

    def reinicia(self):
        """Dá um toque no botão EN pela ficha USB, para a placa começar do princípio."""
        self.s.dtr = False
        self.s.rts = True
        time.sleep(0.1)
        self.s.rts = False
        self.s.reset_input_buffer()
        self.resto = b''

    def manda(self, texto):
        self.anota('> ' + texto)
        self.s.write((texto + '\n').encode())

    def anota(self, texto):
        self.registo.write(f'{time.strftime("%H:%M:%S")} {texto}\n')

    def linhas(self):
        """Devolve as linhas completas que chegaram; se o USB cair, espera e volta a abrir."""
        try:
            self.resto += self.s.read(8192)
        except (serial.SerialException, OSError) as e:
            self.quedas += 1
            self.anota(f'# USB caiu: {e}')
            try:
                self.s.close()
            except Exception:
                pass
            while True:
                time.sleep(2)
                try:
                    self.abre()
                    self.anota('# USB voltou')
                    break
                except (serial.SerialException, OSError):
                    pass
            return []
        saida = []
        while b'\n' in self.resto:
            bruto, self.resto = self.resto.split(b'\n', 1)
            texto = bruto.decode('utf-8', 'replace').strip()
            if texto:
                self.anota(texto)
                saida.append(texto)
        return saida

    def espera(self, prefixo, segundos):
        fim = time.time() + segundos
        while time.time() < fim:
            for l in self.linhas():
                if l.startswith(prefixo):
                    return l
        return None


def configura(placa, ritmo):
    """Manda o ritmo e devolve a resposta da placa (o que o sensor aceitou), ou None."""
    for _ in range(3):
        placa.manda('c %d %d %d %d' % ritmo)
        resposta = placa.espera('C ', 6)
        if resposta:
            return campos(resposta)
    return None


def corre(placa, ritmo, segundos, progresso=0):
    """Corre um ritmo durante 'segundos' e devolve o resumo."""
    conf = configura(placa, ritmo)
    r = {'ritmo': ritmo, 'conf': conf, 'linhas': 0, 'arranques': 0, 'religacoes': 0, 'avisos': 0,
         'a': 0, 'g': 0, 'r': 0, 'pa': 0, 'pg': 0, 'pr': 0, 'ia': 0, 'ig': 0, 'ir': 0,
         'lei': 0, 'fl': 0, 'esc': 0, 'fe': 0, 'dmax': 0, 'rein': 0, 'sil': 0,
         'sx': [], 'sy': [], 'sz': [], 'seg_curtos': 0, 'ultima': None, 'totais': None, 'contadores': []}
    if conf is None:
        r['erro'] = 'a placa não respondeu ao comando'
        return r
    esperado_a = ritmo[1]
    inicio = time.time()
    fim = inicio + segundos
    proximo = inicio + progresso if progresso else None
    primeira = True
    while time.time() < fim:
        for l in placa.linhas():
            if l.startswith('E '):
                if primeira:            # o primeiro segundo vem incompleto
                    primeira = False
                    continue
                e = campos(l)
                r['linhas'] += 1
                for k in ('a', 'g', 'r', 'pa', 'pg', 'pr', 'lei', 'fl', 'esc', 'fe'):
                    r[k] += int(e.get(k, 0))
                for k in ('ia', 'ig', 'ir', 'dmax'):
                    r[k] = max(r[k], int(e.get(k, 0)))
                r['rein'] = max(r['rein'], int(e.get('rein', 0)))
                r['sil'] = max(r['sil'], int(e.get('sil', 0)))
                for k in ('sx', 'sy', 'sz'):
                    r[k].append(e.get(k, 0.0))
                if esperado_a and e.get('a', 0) < 0.9 * esperado_a:
                    r['seg_curtos'] += 1
                r['ultima'] = e
            elif l.startswith('S arranque'):
                r['arranques'] += 1
                primeira = True
            elif l.startswith('S ligado'):
                configura(placa, ritmo)   # a placa recomeçou: volta a pedir o ritmo
                primeira = True
            elif l.startswith('S religar'):
                r['religacoes'] += 1
            elif l.startswith('!') or l.startswith('S ligacao=falhou'):
                r['avisos'] += 1
        if proximo and time.time() >= proximo:
            proximo += progresso
            print('   ' + resume(r, curto=True), flush=True)
    placa.manda('t')
    t = placa.espera('T ', 4)
    r['totais'] = campos(t) if t else None
    placa.manda('n')
    limite = time.time() + 3
    while time.time() < limite and len(r['contadores']) < 3:
        for l in placa.linhas():
            if l.startswith('N '):
                r['contadores'].append(l)
    return r


def resume(r, curto=False):
    b, a, g, rr = r['ritmo']
    if r.get('erro'):
        return f'{b // 1000} kHz {a}/{g}/{rr}: {r["erro"]}'
    s = max(1, r['linhas'])
    falhas = r['fl'] + r['fe']
    texto = (f'{b // 1000:>3} kHz {a:>3}/{g:>3}/{rr:>3} | {r["linhas"]:>6} s | por segundo {r["a"] / s:6.1f} '
             f'{r["g"] / s:6.1f} {r["r"] / s:6.1f} | em falta {r["pa"]}/{r["pg"]}/{r["pr"]} | maior intervalo '
             f'{r["ia"] / 1000:.1f}/{r["ig"] / 1000:.1f}/{r["ir"] / 1000:.1f} ms | fios: {falhas} falhas em '
             f'{r["lei"] + r["esc"]}, a mais demorada {r["dmax"] / 1000:.1f} ms | sensor reiniciou {r["rein"]}, '
             f'calou-se {r["sil"]} | segundos curtos {r["seg_curtos"]}')
    if curto:
        return texto
    extra = []
    if r['arranques'] or r['religacoes'] or r['avisos']:
        extra.append(f'placa recomeçou {r["arranques"]}, ligação refeita {r["religacoes"]}, avisos {r["avisos"]}')
    if r['sx']:
        extra.append('ruído (mediana, m/s2) %.4f %.4f %.4f' % tuple(statistics.median(r[k]) for k in ('sx', 'sy', 'sz')))
    if r['conf']:
        extra.append('intervalo aceite pelo sensor (us) ' + str(r['conf'].get('intervalo_us')))
    if r['ultima']:
        u = r['ultima']
        extra.append('atitude rol %.1f cai %.1f gui %.1f, confiança %d/%d, erro estimado %.1f graus' %
                     (u.get('rol', 0), u.get('cai', 0), u.get('gui', 0), u.get('ea', 0), u.get('er', 0), u.get('prec', 0)))
    for c in r['contadores']:
        extra.append(c)
    return texto + ''.join('\n      ' + x for x in extra)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('porta')
    p.add_argument('modo', choices=['rapido', 'completo', 'resistencia', 'despejo'])
    p.add_argument('--saida', required=True)
    p.add_argument('--horas', type=float, default=3.0)
    p.add_argument('--segundos', type=float, default=20.0)
    p.add_argument('--ritmo', default='400000,100,100,100')
    p.add_argument('--sem-reinicio', action='store_true', help='não toca no botão EN ao abrir')
    args = p.parse_args()

    os.makedirs(args.saida, exist_ok=True)
    nome = os.path.join(args.saida, time.strftime('%Y-%m-%d_%H%M%S') + '_' + args.modo)
    ritmo = tuple(int(x) for x in args.ritmo.split(','))
    with open(nome + '.log', 'w', encoding='utf-8', buffering=1) as registo:
        placa = Placa(args.porta, registo)
        placa.abre()
        if not args.sem_reinicio:
            placa.reinicia()
        ligado = placa.espera('S ligado', 30)
        if not ligado:
            print('A placa não disse "S ligado" em 30 s. Ver ' + nome + '.log')
            return 2
        print(ligado, flush=True)

        if args.modo == 'despejo':
            conf = configura(placa, ritmo)
            print('ritmo:', conf, flush=True)
            time.sleep(2)
            placa.manda('d 1')
            n = 0
            fim = time.time() + args.segundos
            with open(nome + '.csv', 'w', encoding='utf-8') as csv:
                while time.time() < fim:
                    for l in placa.linhas():
                        if l[:2] in ('A ', 'G ', 'R '):
                            csv.write(l.replace(' ', ',') + '\n')
                            n += 1
            placa.manda('d 0')
            placa.espera('S despejo=0', 3)
            print(f'{n} leituras em {nome}.csv')
            return 0

        if args.modo == 'resistencia':
            passos, progresso = [(ritmo, args.horas * 3600)], 600
        else:
            passos, progresso = [(r, 60 if args.modo == 'rapido' else 300) for r in RITMOS], 0
        resumos = []
        for r, dur in passos:
            res = corre(placa, r, dur, progresso)
            resumos.append(res)
            print(resume(res), flush=True)
        with open(nome + '_resumo.txt', 'w', encoding='utf-8') as f:
            f.write(ligado + '\n')
            for res in resumos:
                f.write(resume(res) + '\n')
            f.write(f'quedas do USB: {placa.quedas}\n')
        print(f'quedas do USB: {placa.quedas} | registo: {nome}.log')
    return 0


if __name__ == '__main__':
    sys.exit(main())
