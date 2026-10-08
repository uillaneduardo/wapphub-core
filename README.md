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

**Produção confirmada em 2026-10-08:** Core `72d05aa8c0a3c9f12a8c17abb25ad737b88c65af`,
imagem `wapphub-core:demo-72d05aa`; Chat `3e234522673023a64f6bd7c827ca1adef35aaa0b`,
imagem `wapphub-chat:lucide-nav-3e23452`. Core M1, roster e Demo estão publicados;
catálogo comercial/entitlements/Admin/Minha Conta ainda são escopo planejado M2.

M1 é operacional e as últimas melhorias visuais foram homologadas pelo usuário,
mas **não está formalmente encerrado**: auditoria encontrou prévias que não
respeitam permission/histórico e lacuna de checkpoint no Chat. main remota Core
`fa292c4` ainda não inclui os dois commits Demo publicados. Nenhum código funcional,
serviço ou dado de produção foi alterado nesta reconciliação.

- [Inventário Git/produção](docs/GIT_PRODUCTION_INVENTORY_20261008.md).
- [Arquitetura e matriz de aceite M1](docs/M1_ARCHITECTURE_ACCEPTANCE_20261008.md).
- [Estratégia de integração](docs/GIT_INTEGRATION_STRATEGY_20261008.md).
- [Plano incremental M2](docs/M2_TECHNICAL_PLAN.md), sem implementação iniciada.

Execução: `docs/LOCAL_DEVELOPMENT.md`. Contrato REST: `docs/openapi.json`.
Contrato de eventos M1: `docs/REALTIME_CONTRACT.md`.

```sh
# Configure .env conforme .env.example e a documentação local
scripts/local.sh up
scripts/local.sh validate
scripts/local.sh status
```

Consulte `docs/STATUS.md` para o estado validado de cada entrega.
