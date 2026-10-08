# Reconciliação de produção M1 — 2026-10-08

> **Registro de evidências operacionais reportadas pelo operador/Codex, não auditoria independente do código local.** O estado da `main` remota pode diferir da imagem publicada e das branches locais. Não usar este registro para presumir que commits não enviados já estejam na `main`.

## Evidências posteriores ao STATUS.md da main

- M1 backend integrado anteriormente pelo PR #4, merge commit `89ca5d139ffd6b7e90bfe75a2c60db72621d695a`; migrations M1 aplicadas em produção em execução controlada, conforme relatório do operador.
- Demo Provider (simulação de mensagens externas e internas, permissões específicas, provisionamento idempotente, simulator) publicado em produção no Core commit `72d05aa8c0a3c9f12a8c17abb25ad737b88c65af`, imagem `wapphub-core:demo-72d05aa`. Migrations `20261008020000_demo_provider` e `20261008021000_demo_provider_rbac` aplicadas segundo relatório. 56 testes e checks aprovados na entrega reportada.
- API/Worker/MariaDB/Redis reportados saudáveis após os deploys posteriores de frontend; nenhum restart de backend nos deploys visuais.
- Backup pré-Demo reportado em `/home/uillan/homelab/backups/wapphub-core/wapphub-core-pre-demo-20261008-143259.sql.gz`. Foi verificada a integridade gzip, **não** houve teste de restauração; backup no mesmo host e sem criptografia. Não tratar como recuperação comprovada.
- **Risco de rollback:** Core anterior ao Demo pode não interpretar corretamente direções de mensagens externas já persistidas. Não fazer downgrade isolado do Core após tráfego Demo sem plano de compatibilidade e recuperação.

## Estado do milestone

- M0: entregue segundo evidências anteriores.
- M1: backend e experiência Chat/Demo operacionais em produção conforme homologações manuais reportadas. A **conclusão formal** ainda depende de reconciliar commits locais/remotos, atualizar `docs/STATUS.md` com evidências auditáveis e executar os critérios de aceite finais de M1.
- M2: **não implementado nem autorizado para deploy**. Seu escopo continua sendo `docs/MILESTONES.md`: Product, Plan, Feature, PlanFeature, Subscription, Add-ons, Overrides, Entitlement Resolver, seats, channels, convite condicionado a assentos, WappHub Admin mínimo, Minha Conta mínimo, plano R$ 0,00 e personalização básica.
- M3 Meta, M4 mídia e M5 MVP permanecem milestones distintos. Demo Provider não equivale a Meta real.

## Reconciliação obrigatória no Homelab antes do M2

1. Inventariar `git status`, branches, `HEAD`, `origin/main`, ancestry e commits não enviados em Core e Chat, sem descartar trabalho.
2. Confrontar documentação, migrations e OpenAPI locais com as imagens em execução; confirmar versões efetivas, sem expor segredos.
3. Integrar via PR/revisão os commits efetivamente publicados que ainda não estejam no remoto, **sem** sobrescrever `main` nem alterar produção.
4. Atualizar `README.md`, `docs/STATUS.md`, `docs/DEPLOYMENT.md` e documentação Chat com evidências verificadas. Resolver eventuais conflitos com esta nota.
5. Confirmar aceite M1 e preparar proposta técnica do M2 por fases, mantendo API/DB/produção intocados até autorização posterior.

## Fontes operacionais para conferência

- Core: commit de produção reportado `72d05aa8c0a3c9f12a8c17abb25ad737b88c65af`.
- Frontend: `wapphub-chat:lucide-nav-3e23452`, commit `3e234522673023a64f6bd7c827ca1adef35aaa0b`.
- Relatórios locais: `/home/uillan/homelab/deploy-records/wapphub-chat/`; registros do Core e logs de Compose a identificar.
