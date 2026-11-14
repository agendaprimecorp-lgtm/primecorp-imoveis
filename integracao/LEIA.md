# Para instalar no Propto

`publicos.mts` vai para `netlify/functions/publicos.mts` **no projeto do
Propto**, não neste repositório. Ele está aqui para ficar versionado
junto do contrato que o site espera.

Dois pontos marcados no arquivo precisam ser preenchidos:

1. `lerOfertas(org)` — a leitura do store, a mesma que `/api/dados` usa
2. `urlDaFoto(chave)` — confirmar se `/api/foto` responde sem sessão

O contrato completo, as travas e o que nunca pode sair do Propto estão
em `docs/PROPTO.md`.
