#!/usr/bin/env bash
# ============================================================
# Publica este repositório no GitHub.
# Rode NA SUA MÁQUINA, dentro da pasta do projeto.
#
#   chmod +x publicar-github.sh
#   ./publicar-github.sh
# ============================================================
set -euo pipefail

NOME_BASE="primecorp-imoveis"

echo "== 1. Verificando ferramentas =="
command -v git >/dev/null || { echo "ERRO: git não instalado. https://git-scm.com/downloads"; exit 1; }
command -v gh  >/dev/null || {
  echo "ERRO: GitHub CLI (gh) não instalado."
  echo "  macOS:   brew install gh"
  echo "  Windows: winget install --id GitHub.cli"
  echo "  Linux:   https://github.com/cli/cli/blob/trunk/docs/install_linux.md"
  exit 1
}
git --version; gh --version | head -1

echo
echo "== 2. Verificando autenticação =="
if ! gh auth status >/dev/null 2>&1; then
  echo "Você não está autenticado. Abrindo o login do GitHub..."
  gh auth login --web --git-protocol https
fi
gh auth status
USUARIO=$(gh api user --jq .login)
echo "Conta: $USUARIO"

echo
echo "== 3. Escolhendo um nome livre =="
NOME="$NOME_BASE"
if gh repo view "$USUARIO/$NOME" >/dev/null 2>&1; then
  N=2
  while gh repo view "$USUARIO/$NOME_BASE-$N" >/dev/null 2>&1; do N=$((N+1)); done
  NOME="$NOME_BASE-$N"
  echo "  '$NOME_BASE' já existe. Usando '$NOME' (nada foi sobrescrito)."
else
  echo "  '$NOME' está livre."
fi

echo
echo "== 4. Conferindo que nenhum segredo vai subir =="
if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  echo "ABORTADO: .env está rastreado pelo Git. Rode: git rm --cached .env"; exit 1
fi
echo "  OK — .env não está rastreado."

echo
echo "== 5. Ajustando sua identidade no commit =="
read -rp "  Seu nome para o Git: " GIT_NOME
read -rp "  Seu e-mail do GitHub: " GIT_EMAIL
git config user.name  "$GIT_NOME"
git config user.email "$GIT_EMAIL"
git commit --amend --reset-author --no-edit -q
echo "  Autoria atualizada."

echo
echo "== 6. Criando o repositório público e enviando =="
gh repo create "$NOME" \
  --public \
  --source=. \
  --remote=origin \
  --push \
  --description "Plataforma de intermediação imobiliária: site, painel operacional e Radar de oportunidade de captação."

echo
echo "== 7. Confirmação =="
git remote -v
git branch -vv
echo
echo "Repositório .. $USUARIO/$NOME"
echo "URL ......... $(gh repo view "$USUARIO/$NOME" --json url --jq .url)"
echo "Visibilidade  $(gh repo view "$USUARIO/$NOME" --json visibility --jq .visibility)"
echo "Branch ...... $(git branch --show-current)"
echo "Commit ...... $(git log --format='%h %s' -1)"
echo
echo "Concluído."
