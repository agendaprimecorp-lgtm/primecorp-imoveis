# Configuração do GitHub Actions

## Passo 1: Criar Access Token do Docker Hub

1. Acesse https://hub.docker.com/settings/security
2. Clique "New Access Token"
3. Nome: `propto-ci`
4. Permissões: Read & Write
5. Copie o token (NÃO é a senha)

## Passo 2: Gerar Chave SSH para Deploy

Na sua máquina local:
```bash
ssh-keygen -t ed25519 -f deploy_key -N ""
cat deploy_key  # Isto é seu DEPLOY_KEY secret
cat deploy_key.pub  # Envie para o admin do servidor
```

No servidor de produção:
```bash
# Como usuário de deploy
cat deploy_key.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

## Passo 3: Adicionar Secrets no GitHub

1. Repository → Settings → Secrets and variables → Actions
2. New repository secret:
   - Nome: `DOCKER_USERNAME`, Valor: seu usuário Docker Hub
   - Nome: `DOCKER_PASSWORD`, Valor: o access token (do Passo 1)
   - Nome: `DEPLOY_HOST`, Valor: IP/hostname do servidor (ex: `192.168.1.100`)
   - Nome: `DEPLOY_USER`, Valor: usuário SSH (ex: `ubuntu`)
   - Nome: `DEPLOY_KEY`, Valor: conteúdo do arquivo `deploy_key` (do Passo 2)

## Passo 4: Testar Workflow

1. Faça um pequeno change na branch main
2. Push para GitHub
3. Vá à aba Actions
4. Acompanhe o workflow "Build and Deploy"
5. Deve ver: build → push → deploy

Se falhar, clique no job para ver os logs detalhados.
