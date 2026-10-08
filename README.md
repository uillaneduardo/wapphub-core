# WappHub Core

Backend e núcleo de domínio compartilhado do ecossistema WappHub.

## Responsabilidade

O `wapphub-core` concentra regras de negócio, persistência, autenticação, autorização, multi-tenancy, catálogo comercial, assinaturas, entitlements, conversas, mensagens, integrações e auditoria.

Ele atende os frontends:

- `wapphub-chat`: operação de atendimento.
- `wapphub-platform`: WappHub Admin e Minha Conta.

## Princípios aprovados

- SaaS multiempresa desde a fundação.
- `User` representa uma identidade global WappHub.
- A participação de um usuário em uma empresa é uma `Membership`.
- O perfil/permissões pertencem à Membership, não ao User.
- Um usuário pode participar de várias organizações com perfis diferentes.
- Todo dado operacional é contextualizado pela organização atual.
- Assinatura pertence à organização.
- Recursos são controlados por entitlements, nunca por nomes de planos hardcoded.
- Assentos são recursos quantitativos.
- Membership ativa que consome assento conta contra o entitlement `users.seats`.
- Convite pendente não consome assento.
- A Meta/WhatsApp é um provedor externo; conversas, atribuições, tags, notas e auditoria pertencem ao WappHub.
- O backend é a autoridade de segurança. Restrições no frontend são apenas UX.
- MVP como monólito modular, evitando microserviços prematuros.

## Domínios previstos

- Identity e Sessions
- Organizations e Memberships
- Invitations
- RBAC
- Products, Plans e Features
- Subscriptions, Add-ons e Entitlements
- Contacts
- Channels
- Conversations e Messages
- Assignments
- Tags e Internal Notes
- Media
- Integrations / Meta
- Audit e Integration Events

## Desenvolvimento

A implementação deve seguir os milestones documentados em `docs/MILESTONES.md`.

Antes de modificar código, agentes automatizados e Codex devem ler:

1. `docs/ARCHITECTURE.md`
2. `docs/DOMAIN.md`
3. `docs/MILESTONES.md`
4. `docs/STATUS.md`
5. `AGENTS.md`

Não implementar itens de milestones futuros sem decisão registrada.

## Estado atual

**Produção:** M0 — Fundação publicada e preservada.
**Branch M1:** backend de chat interno; evidências em `docs/M1_VALIDATION.md`.

A fundação inclui API Fastify/TypeScript, Prisma/MariaDB, sessões revogáveis,
Membership/RBAC, segurança web, Redis e processos API/Worker via Compose.
O backend M1 é desenvolvido/validado em ambiente isolado, sem atualizar a
produção. Frontend, Meta e milestones posteriores não fazem parte desta entrega.

Execução: `docs/LOCAL_DEVELOPMENT.md`. Contrato REST: `docs/openapi.json`.
Contrato de eventos M1: `docs/REALTIME_CONTRACT.md`.

```sh
# Configure .env conforme .env.example e a documentação local
scripts/local.sh up
scripts/local.sh validate
scripts/local.sh status
```

Consulte `docs/STATUS.md` para o estado validado de cada entrega.
