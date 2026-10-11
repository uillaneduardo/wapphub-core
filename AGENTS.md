# Instruções para agentes e Codex

Leia antes de modificar este repositório:

1. README.md
2. docs/ARCHITECTURE.md
3. docs/DOMAIN.md
4. docs/FEATURES.md
5. docs/REALTIME_AVAILABILITY.md
6. docs/META_INTEGRATION.md
7. docs/INTEGRATION_DIAGNOSTICS.md
8. docs/SECURITY_PRIVACY.md
9. docs/API_CLIENTS.md
10. docs/PERFORMANCE_BASELINE.md
11. docs/MILESTONES.md
12. docs/STATUS.md

## Regras

- Trabalhe somente no milestone explicitamente solicitado.
- Não implemente itens de milestones futuros por conveniência.
- Não altere decisões arquiteturais sem documentar a necessidade.
- Não acople regras a nomes de planos.
- Não coloque role ou organizationId global em User.
- Não confie em organizationId recebido do cliente sem Membership ativa.
- Toda operação tenant-scoped deve provar isolamento.
- Não exponha Prisma/ORM, stack traces, tokens ou segredos.
- Não introduza microserviços/CQRS/event bus distribuído sem decisão aprovada.
- Controllers finos; regras em application/domain.
- Migrations sempre versionadas.
- Toda ação sensível considera auditoria/security event.
- Toda feature comercial é verificada no backend.
- MetaIntegration e Channel pertencem à Organization.
- Credenciais Meta de Organizations diferentes nunca são compartilhadas.
- Webhook só processa domínio após resolver Organization + Channel.
- WebSocket nunca faz broadcast global de dados tenant-scoped.
- Eventos realtime precisam de contrato estável.
- Mensagens devem considerar clientMessageId/idempotência.
- Chamadas externas críticas devem considerar Outbox/Worker.
- Webhooks externos devem considerar Inbox/IntegrationEvent/idempotência.
- API nasce versionada em /api/v1.
- OpenAPI é contrato oficial REST.
- Não criar endpoint dependente de HTML/browser se a regra pode ser usada pelo futuro Android.
- Sessão web deve seguir docs/SECURITY_PRIVACY.md.
- Não armazenar segredos/senhas/tokens em logs.
- Mídia grande não deve ser carregada desnecessariamente em memória da API.
- Não marcar STATUS como concluído sem validação.

## Definition of Done

Uma tarefa só está concluída quando:
- código implementado;
- testes pertinentes passam;
- testes de autorização/tenant negativos incluídos quando aplicável;
- lint/typecheck/build passam;
- migrations consistentes;
- OpenAPI/event contracts atualizados quando afetados;
- documentação afetada atualizada;
- STATUS atualizado;
- nenhum segredo commitado;
- logs/erros não expõem dados sensíveis.

## Commits

Preferir commits pequenos e descritivos.

Exemplos:
- `feat(auth): add revocable web sessions`
- `feat(organizations): add membership context`
- `feat(realtime): add tenant scoped message events`
- `fix(tenancy): enforce organization scope`
- `docs(status): mark session security complete`

## Fluxo obrigatório de execução — Codex no homelab (2026-10-11)

Este repositório é **coordenador** das mudanças inter-repositório do WappHub. Antes de qualquer trabalho de consolidação WhatsApp/Provider, ler:
- `docs/WHATSAPP_WEB_CONSOLIDATION_EXECUTION.md` — papéis, gates, fluxo técnico e critérios de homologação.
- `docs/WHATSAPP_WEB_CONSOLIDATION_PROGRESS.md` — estado atual, evidências e retomada.
- `services/wapphub-provider-web/AGENTS.md` — responsabilidades específicas do adapter Baileys.

**A execução acontece no Codex do homelab**, que inspeciona Git, Docker, Compose, versões, banco/filas, recursos e relatórios locais; ChatGPT revisa decisões e PRs; o **usuário aprova a arquitetura e homologa no navegador**. Não atribuir a repositório público o estado de produção sem prova local.

**Gate inicial obrigatório:** A0/A1 auditoria detalhada → A2 proposta arquitetural revisável → **uma aprovação do usuário** antes de implementar/refatorar funcionalidades. Depois, etapas B1–B5 podem seguir internamente com testes, checkpoints e commits pequenos sem microaprovações; deploy exige autorização pertinente, preservação da sessão, backups/rollback. Nunca iniciar pareamento/solicitações históricas reais/envio real automaticamente. Homologação visual é exclusiva do usuário e nunca presumida.

**Exigências funcionais incluídas no plano:** enviar e receber mensagens pelo Provider; iniciar nova conversa **por contato existente ou número ainda não cadastrado**, com validação de canal/destinatário/DDD/DDI, tenancy, RBAC, autoria, outbox/idempotência e status; texto, imagem, áudio e vídeo conforme capacidades reais do Baileys. Chamadas fora de escopo. Sincronização live é obrigação do canal ativo; histórico inicial é progressivo dentro do que o WhatsApp fornece. Preservar Demo.

**Retomada:** atualizar o arquivo de progresso **ao iniciar e terminar cada fase**, com ambiente, SHAs, mudanças, comandos/testes, evidências, riscos e próximo passo. Ao reabrir uma sessão, ler progresso e conferir estado real antes de agir. Não afirmar sucesso por testes sintéticos apenas.
