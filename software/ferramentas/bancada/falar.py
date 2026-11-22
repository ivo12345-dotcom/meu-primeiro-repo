# Abre a porta da placa (programa bancada2, 921 600 baud) SEM a reiniciar (a nao ser com --reinicia),
# manda comandos a horas marcadas e mostra tudo o que ela diz. Para diagnosticar a ligacao ao sensor.
#   python falar.py COM3 <segundos> [--reinicia] [--espera] [t=comando ...]   ex.: 2.5="c 100000 100 100 100"
# --espera: fica a espera de a porta aparecer (cabo USB a ser ligado) antes de comecar a contar.
import sys
import time

import serial

sys.stdout.reconfigure(encoding="utf-8")
porta, segundos = sys.argv[1], float(sys.argv[2])
reinicia = "--reinicia" in sys.argv
espera = "--espera" in sys.argv
marcados = []
for a in sys.argv[3:]:
    if "=" in a and not a.startswith("--"):
        t, c = a.split("=", 1)
        marcados.append((float(t), c))
marcados.sort()

s = serial.Serial()
s.port = porta
s.baudrate = 921600
s.timeout = 0.1
s.dtr = False  # as duas linhas em repouso: abrir a porta nao toca no botao EN da placa
s.rts = False
limite = time.time() + 120
while True:
    try:
        s.open()
        break
    except (serial.SerialException, OSError) as e:
        if not espera or time.time() > limite:
            print("nao abre:", e)
            sys.exit(2)
        time.sleep(0.05)
with s:
    if reinicia:
        s.rts = True
        time.sleep(0.1)
        s.rts = False
    inicio = time.time()
    print(f"  0.00 # porta aberta as {time.strftime('%H:%M:%S')}", flush=True)
    resto = b""
    while time.time() - inicio < segundos:
        while marcados and time.time() - inicio >= marcados[0][0]:
            _, c = marcados.pop(0)
            print(f"{time.time() - inicio:6.2f} > {c}", flush=True)
            s.write((c + "\n").encode())
        resto += s.read(4096)
        while b"\n" in resto:
            bruto, resto = resto.split(b"\n", 1)
            texto = "".join(ch if 32 <= ord(ch) < 127 else "." for ch in bruto.decode("latin1").rstrip("\r"))
            if "mac" in texto.lower():
                continue
            print(f"{time.time() - inicio:6.2f} {texto[:300]}", flush=True)
