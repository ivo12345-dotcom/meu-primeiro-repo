#!/usr/bin/env bash
# Constrói o APK só com o SDK Android, sem Gradle:
#   aapt2 compile/link → javac → d8 → junta classes.dex → zipalign → apksigner
# Requisitos: JDK 17 (Temurin), SDK com build-tools 34.0.0 e platforms;android-34.
# Uso: bash build.sh            → out/vts-alges.apk (assinado com a chave de debug ~/.android/debug.keystore)
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_SDK_ROOT:-$LOCALAPPDATA/Android/Sdk}"
BT="$SDK/build-tools/34.0.0"
PLAT="$SDK/platforms/android-34/android.jar"
if [ -z "${JAVA_HOME:-}" ]; then
    JAVA_HOME="$(ls -d "/c/Program Files/Eclipse Adoptium/jdk-17"* 2>/dev/null | head -1)"
fi
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"
KS="$HOME/.android/debug.keystore"
OUT="$AQUI/out"
VC="${VERSION_CODE:-1}"
VN="${VERSION_NAME:-1.0}"

win() { cygpath -w "$1"; }

echo "== JDK: $(java -version 2>&1 | head -1)"
echo "== SDK: $SDK"
rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex"

echo "== aapt2 compile"
"$BT/aapt2.exe" compile --dir "$(win "$AQUI/res")" -o "$(win "$OUT/res.zip")"

echo "== aapt2 link"
"$BT/aapt2.exe" link -o "$(win "$OUT/base.apk")" -I "$(win "$PLAT")" \
    --manifest "$(win "$AQUI/AndroidManifest.xml")" -A "$(win "$AQUI/assets")" \
    --java "$(win "$OUT/gen")" --min-sdk-version 26 --target-sdk-version 34 \
    --version-code "$VC" --version-name "$VN" "$(win "$OUT/res.zip")"

echo "== javac"
find "$AQUI/src" "$OUT/gen" -name '*.java' | while read -r f; do win "$f"; done > "$OUT/fontes.txt"
javac --release 11 -encoding UTF-8 -Xlint:deprecation -d "$(win "$OUT/classes")" -cp "$(win "$PLAT")" @"$(win "$OUT/fontes.txt")"

echo "== d8"
(cd "$OUT/classes" && jar cf ../classes.jar .)
"$BT/d8.bat" --release --min-api 26 --lib "$(win "$PLAT")" --output "$(win "$OUT/dex")" "$(win "$OUT/classes.jar")"

echo "== classes.dex para dentro do APK"
cp "$OUT/base.apk" "$OUT/semalinhar.apk"
python - "$OUT/semalinhar.apk" "$OUT/dex/classes.dex" <<'EOF'
import sys, zipfile
apk, dex = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(apk, 'a', compression=zipfile.ZIP_DEFLATED) as z:
    z.write(dex, 'classes.dex')
EOF

echo "== zipalign"
"$BT/zipalign.exe" -f -p 4 "$(win "$OUT/semalinhar.apk")" "$(win "$OUT/alinhado.apk")"

if [ ! -f "$KS" ]; then
    echo "== a criar chave de debug em $KS"
    mkdir -p "$HOME/.android"
    keytool -genkeypair -v -keystore "$(win "$KS")" -storepass android -alias androiddebugkey -keypass android \
        -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
fi

echo "== apksigner"
"$BT/apksigner.bat" sign --ks "$(win "$KS")" --ks-pass pass:android --key-pass pass:android \
    --ks-key-alias androiddebugkey --out "$(win "$OUT/vts-alges.apk")" "$(win "$OUT/alinhado.apk")"
"$BT/apksigner.bat" verify --print-certs "$(win "$OUT/vts-alges.apk")" | head -3
ls -la "$OUT/vts-alges.apk"
echo "== APK pronto: $OUT/vts-alges.apk"
