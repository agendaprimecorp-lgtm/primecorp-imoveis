# Configuração de Ambiente

## Variáveis Requeridas

### Supabase

- **SUPABASE_URL**: URL do seu projeto Supabase (formato: `https://xxx.supabase.co`)
  - Obtenha em: Painel Supabase → Configurações do Projeto → API → URL do Projeto

- **SUPABASE_ANON_KEY**: Chave API pública para bibliotecas cliente
  - Obtenha em: Painel Supabase → Configurações do Projeto → API → anon public

- **SUPABASE_SERVICE_KEY**: Chave de função serviço privada (somente backend, nunca exponha)
  - Obtenha em: Painel Supabase → Configurações do Projeto → API → service_role secret

- **DATABASE_URL**: String de conexão PostgreSQL
  - Formato: `postgresql://postgres:{password}@{host}:5432/postgres`
  - Obtenha em: Painel Supabase → Configurações do Projeto → Banco de Dados → Connection string (URI)

### Worker

- **WORKER_ID**: Identificador único para esta instância do worker (padrão: `worker-1`)
  - Usado para logging e reserva de jobs
  - Defina como valor diferente por instância se rodar múltiplos workers

- **LOG_LEVEL**: Verbosidade do log (`info`, `debug`, `warn`, `error`)
  - Padrão: `info`

- **NODE_ENV**: Ambiente (`production`, `development`)
  - Padrão: `production` para Docker

## Passos de Configuração

1. **Copiar template**
   ```bash
   cp .env.example .env
   ```

2. **Preencher credenciais do Supabase**
   ```bash
   nano .env
   # Editar:
   # SUPABASE_URL=sua-url
   # SUPABASE_ANON_KEY=sua-chave
   # SUPABASE_SERVICE_KEY=sua-chave-secreta
   # DATABASE_URL=sua-string-conexao
   ```

3. **Testar configuração**
   ```bash
   docker-compose config
   ```

4. **Verificar .gitignore**
   ```bash
   grep "^\.env$" .gitignore
   # Deve mostrar: .env está ignorado (não .env.example)
   ```

## Dúvidas Frequentes

**P: Onde obtenho as credenciais do Supabase?**
R: Acesse https://app.supabase.com → selecione seu projeto → Configurações → API

**P: Posso usar a mesma chave para múltiplos workers?**
R: Sim, SUPABASE_SERVICE_KEY pode ser compartilhada entre workers. WORKER_ID é apenas para identificação no log.

**P: Qual LOG_LEVEL para produção?**
R: Use `info` para produção. Use `debug` apenas para troubleshooting.
