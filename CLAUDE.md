# Convenções deste repositório

## Fluxo de branches — regra obrigatória

- **Toda alteração feita neste PC vai para a branch `rodrigo`.**
- **`git push` sempre para `origin rodrigo`.** Nunca para `main`.
- **Merge para `main` não está autorizado.** Não abrir, não aprovar e não
  concluir merge/PR para `main` sem autorização explícita do dono do repositório.
- `main` é somente leitura a partir daqui: serve de referência do estado publicado.

Há um hook local em `.git/hooks/pre-push` que bloqueia push para `main`/`master`.
Ele é uma rede de segurança, não substitui a regra acima.

## Segredos

- `.env` nunca é versionado (ver `.gitignore`). Só `.env.example`, sem valores.
- Antes de qualquer push, conferir que nenhum segredo entrou no commit.
