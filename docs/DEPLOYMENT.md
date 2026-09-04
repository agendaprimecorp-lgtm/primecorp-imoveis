# Deploy em Produção do Propto

## Início Rápido (5 minutos)

### Pré-requisitos
- Servidor Linux (Ubuntu 22.04 LTS recomendado)
- Docker + docker-compose instalados
- Projeto Supabase com credenciais

### Instalação

1. **Clonar repositório**
   ```bash
   git clone https://github.com/primecorp/propto.git
   cd propto
   ```

2. **Copiar template de ambiente**
   ```bash
   cp .env.example .env
   ```

3. **Preencher credenciais do Supabase**
   ```bash
   nano .env
   # Editar:
   # SUPABASE_URL=sua-url
   # SUPABASE_ANON_KEY=sua-chave
   # SUPABASE_SERVICE_KEY=sua-chave-secreta
   # DATABASE_URL=sua-string-conexao
   ```

4. **Iniciar serviços**
   ```bash
   docker-compose up -d
   ```

5. **Verificar se o worker está rodando**
   ```bash
   docker-compose logs capture-worker
   # Deve mostrar: "✅ Iniciando worker de jobs de IA..."
   ```

## Setup Detalhado

### 1. Preparação do Servidor

```bash
# Atualizar sistema
sudo apt-get update && sudo apt-get upgrade -y

# Instalar Docker (Ubuntu 22.04)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Instalar docker-compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### 2. Obter Credenciais do Supabase

Do Painel Supabase (https://app.supabase.com):
1. Selecione seu projeto
2. Configurações → API
3. Copie:
   - Project URL → SUPABASE_URL
   - anon public key → SUPABASE_ANON_KEY
   - service_role secret → SUPABASE_SERVICE_KEY
4. Configurações → Banco de Dados → Connection string (URI mode) → DATABASE_URL

### 3. Deploy em Servidor Novo

```bash
cd /opt/propto  # ou onde você clonar

# Setup do ambiente
cp .env.example .env
nano .env  # preencher credenciais

# Primeira execução: puxa imagens, roda migrações
docker-compose up -d

# Aguardar 30 segundos para migrações completarem
sleep 30

# Verificar logs
docker-compose logs capture-worker | tail -20
```

## Manutenção

### Ver logs
```bash
docker-compose logs capture-worker -f
```

### Reiniciar worker
```bash
docker-compose restart capture-worker
```

### Parar todos os serviços
```bash
docker-compose down
```

### Backup do banco
```bash
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d-%H%M%S).sql
```

## Monitoramento

### Verificar status do worker
```bash
docker-compose ps
# STATUS deve ser "Up X seconds"
```

### Contar jobs pendentes
```bash
# Conecte no SQL Editor do Supabase e execute:
SELECT status, COUNT(*) FROM ai_jobs GROUP BY status;
```

### Ver logs de erro
```bash
docker-compose logs capture-worker | grep -i error
```

## Troubleshooting

### Worker falha na inicialização
- Verificar `.env` preenchido corretamente: `docker-compose config`
- Verificar credenciais do Supabase são válidas
- Verificar banco acessível: `docker-compose exec capture-worker npm run migrate`

### Arquivos de áudio não uploadam
- Verificar bucket `audio` do Supabase Storage existe e é privado
- Verificar políticas de RLS permitem uploads autenticados

### Deploy via CI/CD falha
- Verificar GitHub Secrets estão definidos (DOCKER_USERNAME, DOCKER_PASSWORD, etc.)
- Verificar conta Docker Hub tem permissões de push

## Scaling

Para múltiplos workers (opcional):
```yaml
# No docker-compose.yml, duplicar serviço capture-worker:
capture-worker-2:
  extends: capture-worker
  container_name: propto-worker-2
  environment:
    WORKER_ID: worker-2
```

Então: `docker-compose up -d capture-worker capture-worker-2`
