# GitHub Actions — Pipeline CI/CD

## Secrets Requeridos

Adicione estes no GitHub Repository → Settings → Secrets and variables → Actions:

1. **DOCKER_USERNAME** - Seu usuário Docker Hub
2. **DOCKER_PASSWORD** - Access token Docker Hub (não a senha)
   - Crie em: https://hub.docker.com/settings/security
3. **DEPLOY_HOST** - IP ou hostname do servidor de produção (ex: `192.168.1.100`)
4. **DEPLOY_USER** - Usuário SSH no servidor de produção (padrão: `ubuntu`)
5. **DEPLOY_KEY** - Chave privada SSH para o usuário de deploy
   - Gere: `ssh-keygen -t ed25519 -f deploy_key`
   - Adicione chave pública a `~/.ssh/authorized_keys` no servidor

## Fluxo do Workflow

1. Push para branch `main` → GitHub Actions executa automaticamente
2. Docker image é construída e enviada para Docker Hub
3. SSH no servidor de produção e puxa a imagem mais recente
4. Reinicia capture-worker com a nova versão
5. Mostra os últimos 10 linhas de log para verificar startup

## Trigger Manual

GitHub UI → Actions → "Build and Deploy" → "Run workflow" → Selecionar branch → Run

## Ver Logs

GitHub UI → Actions → Workflow mais recente → Clique no job para detalhes
