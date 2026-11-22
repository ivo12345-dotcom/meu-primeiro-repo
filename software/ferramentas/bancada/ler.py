# Lê o que uma placa manda pelo USB durante N segundos e mostra cada linha com a hora.
# Serve para o programa de bancada 1 (placa), que fala a 115 200 baud.
#
#   python ler.py COM5 12              12 segundos, a 115 200 baud
#   python ler.py COM5 12 921600       outra velocidade
#
# Ao abrir a porta dá um toque no botão EN da placa, para ela começar do princípio. Precisa do pyserial.
import sys
import time

import serial

sys.stdout.reconfigure(encoding='utf-8')
porta, segundos = sys.argv[1], float(sys.argv[2])
velocidade = int(sys.argv[3]) if len(sys.argv) > 3 else 115200

with serial.Serial(porta, velocidade, timeout=0.2) as s:
    s.dtr = False
    s.rts = True
    time.sleep(0.1)
    s.rts = False
    fim = time.time() + segundos
    resto = b''
    while time.time() < fim:
        resto += s.read(4096)
        while b'\n' in resto:
            bruto, resto = resto.split(b'\n', 1)
            print(time.strftime('%H:%M:%S'), bruto.decode('utf-8', 'replace').rstrip('\r'), flush=True)
