#!/usr/bin/env bash
# Backup que nunca foi restaurado nao e backup.
# Restaura o ultimo backup em container efemero e valida integridade.
# Rodar SEMANALMENTE via cron. Falha aqui = incidente.
set -euo pipefail
SRC="${1:-./backups/base}"
ULTIMO=$(ls -t "$SRC"/base_*.tar.gz | head -1)
TMP=$(mktemp -d)
echo "Testando restauracao de: $ULTIMO"
tar -xzf "$ULTIMO" -C "$TMP"
docker run --rm -d --name pc_restore_test -e POSTGRES_PASSWORD=teste_efemero \
  -v "$TMP:/var/lib/postgresql/data" postgis/postgis:16-3.4 >/dev/null
for i in $(seq 1 30); do docker exec pc_restore_test pg_isready -U primecorp && break || sleep 2; done
FALHOU=0
verifica() {
  if [ "$(docker exec pc_restore_test psql -U primecorp -d primecorp -tAc "$2")" != "0" ]; then
    echo "  OK    $1"; else echo "  FALHA $1"; FALHOU=1; fi
}
verifica "tabela users tem registros"  "SELECT count(*) FROM users"
verifica "tabela assets acessivel"     "SELECT count(*) FROM assets"
verifica "PostGIS carregado"           "SELECT count(*) FROM pg_extension WHERE extname='postgis'"
verifica "trigger de CRECI presente"   "SELECT count(*) FROM pg_trigger WHERE tgname='mandato_exige_creci'"
docker rm -f pc_restore_test >/dev/null; rm -rf "$TMP"
[ "$FALHOU" -eq 0 ] && echo "RESTORE VALIDADO" || { echo "RESTORE FALHOU - INCIDENTE"; exit 1; }
