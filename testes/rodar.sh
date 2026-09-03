#!/usr/bin/env bash
# Bateria completa: backend (Python) e telas + motor (DOM headless).
#
# Requer, uma vez:
#   pip install -r requirements.txt
#   npm install
#
# Sai com codigo 1 se qualquer bateria reprovar -- e o que o CI le.
set -uo pipefail
cd "$(dirname "$0")/.."

falhou=0

bateria() {
  local nome="$1"; shift
  echo
  echo "== $nome =="
  if "$@"; then
    echo "-- $nome: ok"
  else
    echo "-- $nome: FALHOU"
    falhou=1
  fi
}

bateria backend python3 -m pytest tests/ -q
bateria motor   node testes/motor.test.js
bateria site    node testes/site.test.js
bateria painel  node testes/painel.test.js

echo
if [ "$falhou" -ne 0 ]; then
  echo "BATERIA REPROVADA"
  exit 1
fi
echo "BATERIA APROVADA"
