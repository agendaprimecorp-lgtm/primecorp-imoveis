# Propto Landing Page — Design Spec

> **Goal:** Landing page profissional em Astro com dual-persona (corretores + donos de imobiliária), múltiplos CTAs em cascata, integração Supabase para captura de leads, e dashboard de analytics. Pronto em 3 dias.

**Architecture:** Astro SSR + React islands (forms) + Supabase backend + Vercel deploy. Analytics via eventos Supabase. Email automático via SendGrid/Resend.

**Tech Stack:** Astro 4.x · React 18.x · Supabase (auth, database, edge functions) · TailwindCSS · Vercel

**Timeline:** 3 dias (Seg-Qua)

---

## Global Constraints

- **Responsivo:** Mobile-first (58% do tráfego imóvel é mobile)
- **Conversão:** Formulários rápidos (3 campos max: email, nome, persona)
- **Privacidade:** LGPD — política de privacidade + consentimento explícito
- **Email:** Verificação dupla (double-opt-in) antes de incluir em mailing
- **Sem tracking:** Google Analytics opcional; foco em Supabase events
- **Deploy:** Vercel (gratuito no plano free, sem lock-in)
- **Banco de Dados:** Tabelas `leads` + `eventos` com RLS para você só ver seus próprios dados
- **Idioma:** Português brasileiro
- **Cores:** Primária #0066FF (azul), Secundária #10B981 (verde), Neutro #1F2937 (cinza)

---

## Estrutura de Página

### Seção 1: Hero
**Público:** Ambos
**Copy:** "Captura de imóvel em 3 minutos. Extração automática de dados."
**CTA primária:** "Comece trial grátis" (modal/inline form)
**Visual:** Imagem/vídeo do app gravando áudio, com ícone de checkmark para cada benefício
**Goals:** 
- Ganhar atenção em 3 segundos
- Deixar claro o que é Propto
- Primeira chance de conversão

### Seção 2: O Problema
**Público:** Ambos
**Copy:** Mostrar dor (gravações manuais, transcrição manual, dados digitados)
**Visual:** Antes/depois ou timeline de workflow antigo vs novo
**Goals:** Validar que você tem um problema que Propto resolve

### Seção 3: Como Funciona
**Público:** Corretores (tech-focused)
**Copy/Visual:** 3 passos ilustrados
  1. Grava áudio no imóvel (offline)
  2. App faz upload automático
  3. Propto extrai dados (descrição, preço, dormitórios, etc)
**Goals:** Mostrar fluxo técnico, remove fricção ("Funciona offline? Sim!")

### Seção 4: Benefícios para Donos
**Público:** Donos de imobiliária
**Copy:** 3-4 bullets
  - Equipe 3x mais produtiva (menos tempo em digitação)
  - Conformidade garantida (sem erro de dados)
  - Integração com seu sistema (API pronta)
  - Relatórios em tempo real (dashboard)
**Visual:** Ícones + números (ex: "3 min/captura vs 20 min manual")

### Seção 5: Prova Social
**Público:** Ambos
**Content:**
  - "500+ corretores já usam"
  - "10.000 imóveis processados"
  - "98% de satisfação"
**Visual:** Logo de 3-4 imobiliárias (fictícias ok no MVP, reais depois)
**Goals:** Confiança, FOMO

### Seção 6: CTA Trial (Formulário)
**Público:** Ambos
**Form fields:**
  1. Email (required, validate)
  2. Nome (required)
  3. Persona (radio: Corretor / Dono de Imobiliária / Curioso)
  4. Checkbox: "Li e concordo com política de privacidade"
**Behavior:**
  - Submit → Supabase
  - Success → Redireciona para `/obrigado`
  - Email automático com link de confirmação
**Goal:** Capturar lead qualificado

### Seção 7: CTA Demo
**Público:** Donos (secundário)
**Copy:** "Prefere falar com a gente primeiro?"
**Component:** Calendly embed (seu calendário)
**Goal:** High-touch para enterprise

### Seção 8: CTA Guia
**Público:** Corretores (lead magnet)
**Copy:** "Baixe o guia 'Captura de Imóvel em 3 Minutos'"
**Form:** Email + nome (simples)
**Behavior:** Download PDF + subscribe a email
**Goal:** Lead magnet alternativo

### Seção 9: App Mobile
**Público:** Ambos
**Component:** Badge "Baixe no App Store" / "Google Play"
**Link:** Para seu app (verificar stores: iOS + Android)
**Goal:** Tráfego direto pro app

### Seção 10: Footer
**Content:**
  - Links legais: Privacidade, Termos, Contato
  - Email: contato@primecorpconsultoria.com.br
  - Links sociais (LinkedIn, etc)
  - © 2026 PrimeCorp
**Goal:** Confiança + conformidade

---

## Banco de Dados (Supabase)

### Tabela: `leads`
```sql
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  persona TEXT CHECK (persona IN ('corretor', 'dono_imobi', 'nao_informado')),
  origem_cta TEXT CHECK (origem_cta IN ('hero', 'demo', 'guia', 'app')),
  mensagem TEXT,
  criado_em TIMESTAMP DEFAULT NOW(),
  confirmado BOOLEAN DEFAULT FALSE,
  token_confirmacao TEXT UNIQUE,
  confirmado_em TIMESTAMP,
  metadata JSONB -- utm_source, device, browser, etc
);

-- RLS: você só vê seus próprios leads (authenticated user)
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_see_own_leads" ON leads
  FOR SELECT USING (auth.uid() = current_user_id);
```

### Tabela: `eventos`
```sql
CREATE TABLE eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  tipo TEXT CHECK (tipo IN ('visitou', 'clicou_cta', 'preencheu_form', 'confirmou_email')),
  metadata JSONB, -- utm_source, device, cta_nome, etc
  criado_em TIMESTAMP DEFAULT NOW()
);
```

---

## Fluxo de Conversão

```
Visitante chega
  ↓
Log: evento "visitou" (origin_cta = null)
  ↓
Vê Hero, clica "Comece trial grátis"
  ↓
Modal: Formulário (email, nome, persona)
  ↓
Submit → Supabase INSERT leads
  ↓
Supabase trigger: gera token, envia email
  ↓
Visitante vê: "Verifique seu email"
  ↓
Clica link email → POST /api/confirm?token=xxx
  ↓
Supabase: UPDATE leads SET confirmado=true
  ↓
Você recebe notificação: "Novo lead confirmado: João, corretor"
  ↓
(Opcional) Auto-reply email para lead
```

---

## Páginas & Rotas

| Rota | Componente | Auth | Descrição |
|------|-----------|------|-----------|
| `/` | Landing (Astro) | Public | Main landing |
| `/obrigado` | ThanksPage (Astro) | Public | Pós-cadastro |
| `/dashboard` | LeadsDashboard (React) | Private (você) | Seus leads em tempo real |
| `/api/subscribe` | Edge Function | Public | POST para cadastro |
| `/api/confirm` | Edge Function | Public | GET para confirmar email |
| `/politica-privacidade` | Legal (Astro) | Public | LGPD compliance |

---

## Email Automático

**Template 1: Confirmação**
```
Subject: Confirme seu email — Propto Trial
From: noreply@propto.primecorpconsultoria.com.br

Oi [Nome],

Clique no link abaixo para ativar seu trial:
[Link de confirmação com token]

Link expira em 7 dias.
```

**Template 2: Welcome (após confirmação)**
```
Subject: Bem-vindo ao Propto! 🎉
From: contato@primecorpconsultoria.com.br

Oi [Nome],

Seu trial está ativo! Comece a gravar imóveis agora:
[Link para app]

Dúvidas? Responda este email ou agende uma demo:
[Link Calendly]
```

---

## Analytics & Métricas

**Dashboard mostrará (você):**
- Total de leads (semana, mês)
- Taxa de conversão por CTA (hero vs demo vs guia)
- Distribuição de personas (corretor vs dono)
- Emails confirmados vs pendentes
- Origem (utm_source: organic, direct, social, etc)
- Tempo medio para confirmação

**Evento tracking:**
- `visitou` → Page load
- `clicou_cta` → Click em hero CTA
- `preencheu_form` → Form submit
- `confirmou_email` → Email confirmation

---

## Sucesso (Critério de Aceite)

- [ ] Landing acessível em produção (Vercel)
- [ ] Formulário funciona, salva em Supabase
- [ ] Email de confirmação dispara automaticamente
- [ ] Dashboard mostra leads em tempo real
- [ ] Responsivo em mobile (375px+)
- [ ] Sem erros de JS (console limpo)
- [ ] LGPD compliant (política + consentimento)
- [ ] 1-click deploy (Vercel + env vars configuradas)

---

## Roadmap Futuro (pós-MVP)

- Integração com Calendly automática
- SMS em vez de email (SMS+Email hybrid)
- Webhooks para seu CRM (sync leads automaticamente)
- Página de caso de uso por vertical (corretoras vs franquias)
- Blog com SEO (capturar tráfego orgânico)
