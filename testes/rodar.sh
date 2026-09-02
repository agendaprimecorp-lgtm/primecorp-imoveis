#!/usr/bin/env bash
# Bateria completa: backend (Python) e telas + motor (DOM headless).
# Requer, uma vez: npm install jsdom
set -e
cd "$(dirname "$0")/.."
for f in "== backend ==|python3 -m pytest tests/ -q" ; do :; done
echo "== backend =="; python3 -m pytest tests/ -q | tail -1
echo; echo "== motor ==";  node testes/motor.test.js  2>/dev/null | tail -1
echo; echo "== site ==";   node testes/site.test.js   2>/dev/null | tail -1
echo; echo "== painel =="; node testes/painel.test.js 2>/dev/null | tail -1
