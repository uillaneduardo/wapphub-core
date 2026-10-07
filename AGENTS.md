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
