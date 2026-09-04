#!/bin/bash
set -e

echo "🚀 Propto Worker Iniciando..."

# Aguardar banco se necessário
if [ ! -z "$WAIT_FOR_DB" ]; then
  echo "⏳ Aguardando banco de dados..."
  timeout 30 bash -c "until pg_isready -h $(echo $DATABASE_URL | grep -oP 'localhost|[0-9.]+') -U postgres; do sleep 1; done" || true
fi

# Executar migrações
if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "🔄 Executando migrações do banco..."
  npm run migrate || echo "⚠️  Migrações puladas ou falharam (pode ser normal na primeira execução)"
fi

# Iniciar worker
echo "✅ Iniciando worker de jobs de IA..."
exec npm -w @propto/capture-worker run start
