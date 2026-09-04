# Propto Landing Page — Plano de Implementação

> **Para execução:** Use `superpowers:subagent-driven-development` para implementar task-by-task com reviews.

**Goal:** Construir landing page responsiva em Astro com dual-persona, múltiplos CTAs, backend Supabase, e deploy Vercel pronto em 3 dias.

**Architecture:** Astro SSR com React islands (formulários interativos). Supabase para banco + edge functions. Tailwind CSS para estilo. Email via Resend. Deploy automático Vercel.

**Tech Stack:** Astro 4.x · React 18.x · Supabase · TailwindCSS · Vercel · Resend (email)

**Spec:** `docs/superpowers/specs/2026-09-04-propto-landing-page-design.md`

## Global Constraints

- Responsivo mobile-first (58% do tráfego é mobile)
- Formulários: máximo 3 campos (email, nome, persona)
- LGPD: duplo consentimento antes de emails
- Cores: primária #0066FF, secundária #10B981, neutro #1F2937
- Português brasileiro
- Deploy: Vercel (free tier ok)
- Email: dupla verificação (double-opt-in)
- Sem tracking externo (Supabase events apenas)

---

## Tasks (8 total, 3 dias)

- [ ] Task 1: Setup Astro + Git + Env
- [ ] Task 2: Supabase Setup (Banco + RLS)
- [ ] Task 3: React Forms (Trial, Demo, Guide)
- [ ] Task 4: Componentes Astro (Hero → Footer)
- [ ] Task 5: Página Principal + Layout
- [ ] Task 6: API Endpoints (Subscribe + Confirm)
- [ ] Task 7: Página de Sucesso + Legal
- [ ] Task 8: Deploy Vercel + Configuração Final

[Veja o spec completo para detalhes passo-a-passo de cada task]
