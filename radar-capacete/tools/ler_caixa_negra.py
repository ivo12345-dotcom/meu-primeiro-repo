# Lê a gravação da "caixa negra" do radar pelo cabo USB.
#   python -I tools/ler_caixa_negra.py [COM3]
# Reinicia a placa, manda 'D' durante o arranque e grava o ficheiro em gravacoes/.
import os, sys, time, datetime
import serial

port = sys.argv[1] if len(sys.argv) > 1 else "COM3"
here = os.path.dirname(os.path.abspath(__file__))
outdir = os.path.join(here, "..", "gravacoes")
os.makedirs(outdir, exist_ok=True)

s = serial.Serial(port, 115200, timeout=0.05)
# reiniciar a placa (EN pelo RTS, IO0 alto pelo DTR) - como o esptool
s.dtr = False
s.rts = True
time.sleep(0.15)
s.rts = False

buf = b""
t0 = time.time()
started = False
while time.time() - t0 < 60:
    if not started:
        s.write(b"D")
    chunk = s.read(4096)
    if chunk:
        buf += chunk
        if not started and b"===INICIO" in buf:
            started = True
            t0 = time.time()
        if b"===FIM===" in buf:
            break
    elif not started and time.time() - t0 > 8:
        break
s.close()

if b"===INICIO" not in buf:
    print("ERRO: a placa nao respondeu. Esta ligada no", port, "?")
    print(buf[-400:].decode("utf-8", "replace"))
    sys.exit(1)
body = buf.split(b"===INICIO", 1)[1]
body = body.split(b"\n", 1)[1] if b"\n" in body else b""
body = body.split(b"===FIM===", 1)[0].strip()
name = datetime.datetime.now().strftime("rec_%Y%m%d_%H%M%S.txt")
path = os.path.join(outdir, name)
open(path, "wb").write(body + b"\n")
lines = body.decode("utf-8", "replace").splitlines()
print("OK", os.path.normpath(path), len(body), "bytes,", len(lines), "linhas")
print("primeira:", lines[0] if lines else "(vazia)")
