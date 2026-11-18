// Constrói a app dos óculos:
//   dist/index.html + dist/app.js   -> para o pacote .ehpk e para o simulador
//   ../src/g2_app.h                 -> a mesma app, numa página só e comprimida, servida pela placa em /g2
//   node tools/build.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
execSync('npx esbuild src/main.js --bundle --minify --format=iife --target=es2019 --outfile=dist/app.js',
  { cwd: root, stdio: 'inherit' });
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
fs.writeFileSync(path.join(dist, 'index.html'), html);

// página única (JS dentro) para a placa
const js = fs.readFileSync(path.join(dist, 'app.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const single = html.replace('<script src="app.js"></script>', `<script>${js}</script>`);
const gz = zlib.gzipSync(Buffer.from(single, 'utf8'), { level: 9 });
const hex = [...gz].map((b) => '0x' + b.toString(16).padStart(2, '0'));
const lines = [];
for (let i = 0; i < hex.length; i += 24) lines.push('  ' + hex.slice(i, i + 24).join(','));
fs.writeFileSync(path.join(root, '..', 'src', 'g2_app.h'),
  `#pragma once\n// GERADO por oculos-g2/tools/build.mjs - não editar à mão.\n// App dos óculos G2 (página única, gzip), servida em http://192.168.4.1/g2\n` +
  `#include <Arduino.h>\nstatic const size_t G2_APP_GZ_LEN = ${gz.length};\n` +
  `static const uint8_t G2_APP_GZ[] PROGMEM = {\n${lines.join(',\n')}\n};\n`);
console.log(`app.js ${fs.statSync(path.join(dist, 'app.js')).size} B, página única ${single.length} B, gzip ${gz.length} B`);
