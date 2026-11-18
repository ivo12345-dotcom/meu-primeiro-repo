"""Caixa de teste do radar: base + tampa, K2 Pro, Deeplee PLA+ preto."""
import sys, json, subprocess
from pathlib import Path
sys.path.insert(0, r"C:\Users\ivo12\Documents\OrcaCLI")
import flatten
HERE = Path(__file__).resolve().parent
OUT = HERE / "out"; OUT.mkdir(exist_ok=True)
ORCA = Path(r"C:\Program Files\OrcaSlicer")
O = Path(r"C:\Users\ivo12\Documents\OrcaCLI")
RES = Path(r"C:\Program Files\OrcaSlicer\resources\profiles\Creality")
L = lambda p: json.load(open(p, encoding="utf-8"))
w = lambda p: str(p).replace("\\", "/")
IP = sys.argv[1] if len(sys.argv) > 1 else "192.168.1.178"
m = L(O / "USE_machine.json"); m["print_host"] = f"{IP}:7125"
p = L(O / "USE_process.json")
p.update({"layer_height": "0.2", "wall_loops": "3", "top_shell_layers": "4", "bottom_shell_layers": "4",
          "sparse_infill_density": "15%", "sparse_infill_pattern": "grid", "enable_support": "0",
          "brim_type": "no_brim", "seam_position": "aligned",
          "skirt_loops": "3", "skirt_distance": "4", "skirt_height": "1", "min_skirt_length": "0"})
json.dump(m, open(HERE / "m.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
json.dump(p, open(HERE / "p.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
flatten.build(str(RES / "filament" / "Generic PLA @K2 Pro-all.json"), "filament", str(HERE / "f.json"))
f = L(HERE / "f.json")
f.update({"nozzle_temperature": ["210"], "nozzle_temperature_initial_layer": ["215"],
          "filament_flow_ratio": ["0.95"], "pressure_advance": ["0.04"], "enable_pressure_advance": ["1"],
          "filament_max_volumetric_speed": ["19"], "filament_retraction_length": ["0.4"]})
json.dump(f, open(HERE / "f.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
g = OUT / "plate_1.gcode"
if g.exists(): g.unlink()
C = HERE.parent
cmd = [str(ORCA / "orca-slicer.exe"), "--slice", "0",
       "--load-settings", f"{w(HERE/'m.json')};{w(HERE/'p.json')}",
       "--load-filaments", w(HERE / "f.json"), "--arrange", "1", "--orient", "0",
       "--outputdir", w(OUT), w(C / "caixa_teste_base.stl"), w(C / "caixa_teste_tampa.stl")]
r = subprocess.run(cmd, cwd=ORCA, capture_output=True, text=True, errors="ignore")
print(f"rc=0x{r.returncode & 0xFFFFFFFF:08X} gcode={g.exists()} {((r.stdout or '') + (r.stderr or '')).strip()[-300:]}")
