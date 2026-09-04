# Checklist de Lançamento em Produção

Complete antes de ir live. Cada item é pass/fail binário.

## Infraestrutura (Semana 1)

- [ ] Servidor provisionado (Ubuntu 22.04 LTS, 2+ CPU, 4+ GB RAM)
- [ ] Docker + docker-compose instalados
- [ ] Acesso SSH com chave (sem senhas)
- [ ] Firewall configurado (apenas SSH + seu IP de escritório)
- [ ] Arquivo `.env` criado com todas as credenciais Supabase
- [ ] `docker-compose config` roda sem erros
- [ ] `docker-compose up -d` inicia sem crashes

## Banco de Dados (Semana 1)

- [ ] Projeto Supabase criado (instância de produção)
- [ ] Todas as migrações aplicadas (teste com `npm run migrate` localmente)
- [ ] Políticas de RLS verificadas (teste com app mobile)
- [ ] Backup testado: consegue restaurar de SQL dump
- [ ] Bucket de áudio criado e privado
- [ ] Política de retenção definida (se necessário)

## Worker (Semana 1)

- [ ] Image Docker constrói localmente: `docker build -t propto-worker:test .`
- [ ] Worker inicia em docker-compose: `docker-compose up capture-worker`
- [ ] Worker conecta ao Supabase sem erros
- [ ] Worker processa job de teste (criar entrada dummy em `ai_jobs`)
- [ ] Logs estão limpos (sem exceções não tratadas)

## Mobile (Semana 1)

- [ ] App mobile conecta ao Supabase de produção (JWT, auth)
- [ ] Gravação funciona offline
- [ ] Fila de upload enfileira corretamente
- [ ] Sessão criada em tabela `capture_sessions`
- [ ] Arquivo de áudio aparece em Storage
- [ ] Job aparece em `ai_jobs` com status `queued`
- [ ] Worker pega job e processa
- [ ] Transcrição escrita em tabela `transcriptions`
- [ ] Rascunho escrito em tabela `property_drafts`

## GitHub Actions (Semana 1)

- [ ] Repository tem GitHub Secrets definidos (todos os 5 requeridos)
- [ ] Arquivo workflow existe: `.github/workflows/deploy.yml`
- [ ] Workflow executa em push para main (manual trigger: Actions → Run workflow)
- [ ] Docker image é pushado para Docker Hub com sucesso
- [ ] Servidor de produção auto-puxa e reinicia worker
- [ ] Nenhum segredo exposto nos logs

## Documentação (Semana 1)

- [ ] README.md tem link para produção
- [ ] DEPLOYMENT.md está completo + testado (você seguiu cada passo)
- [ ] ENVIRONMENT.md documenta todas as variáveis `.env`
- [ ] CI-CD.md explica o workflow
- [ ] GITHUB-SETUP.md tem walkthrough de setup dos secrets

## Teste End-to-End (Dia 7)

### Teste Completo

1. App mobile grava 3+ minutos de áudio
2. Submete para captura (offline OK, vem online depois)
3. Áudio faz upload para Storage
4. Worker pega job
5. Transcrição completa em < 2 min
6. Extração completa em < 1 min
7. Rascunho visível na UI do corretor
8. Sem perda de dados ao crashar (parar worker mid-job, reiniciar, deve retomar)

### Teste de Carga

1. Submeter 5 jobs simultaneamente
2. Worker processa tudo (pode ficar em fila)
3. Nenhum job é perdido
4. Sem corrupção de banco

### Teste de Recuperação de Falha

1. Parar docker-compose no meio de um upload
2. Reiniciar app mobile
3. Upload deve retomar (não reiniciar do zero)
4. Worker deve pegar de onde parou

## Aprovação

- [ ] Todos os itens completos
- [ ] Teste end-to-end passou
- [ ] Teste de carga passou
- [ ] Recuperação de falha testada
- [ ] Revisão legal/compliance (se necessário)
- [ ] Stakeholders notificados

**Data de aprovação:** ___________
**Assinado por:** _____________

## Pós-Lançamento (Semana 2+)

- [ ] Monitorar logs diariamente na primeira semana
- [ ] Configurar rotação de logs (volumes docker-compose crescem)
- [ ] Testar restore de backup toda semana
- [ ] Documentar qualquer intervenção manual necessária
