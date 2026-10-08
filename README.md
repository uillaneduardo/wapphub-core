# WappHub Core

> **M1 funcionalmente homologado; consolidação administrativa Git pendente.** [Aceite formal](docs/M1_FINAL_ACCEPTANCE.md) e [STATUS](docs/STATUS.md). Nenhuma nova função/M2 ou publicação nesta auditoria.

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

M1 funcionalmente homologado pelo usuário. Core/API/Worker publicado `a45fb330ceeb6a703c463174f4fa560ad070e226`, imagem `wapphub-core:m1-contacts-a45fb33`; Chat `6b04e653d03fa5b06aafad205b9c760072c01fd0`, imagem `wapphub-chat:m1-contacts-6b04e65`. P0, P1 e contatos/criação manual homologados. Encerramento administrativo Git pendente; M2 não iniciado nesta auditoria.

- [Aceite formal e matriz vigente](docs/M1_FINAL_ACCEPTANCE.md).
- [Inventário final e estratégia de consolidação](docs/M1_FINAL_GIT_CONSOLIDATION.md).
- [Histórico de releases](docs/M1_RELEASE_HISTORY.md).
- [Deploy homologado e contingência](docs/DEPLOY_M1_CONTACTS_20261008.md).
- [Plano M2 preexistente](docs/M2_TECHNICAL_PLAN.md), sem implementação iniciada.

Execução: `docs/LOCAL_DEVELOPMENT.md`. Contrato REST: `docs/openapi.json`.
Contrato de eventos M1: `docs/REALTIME_CONTRACT.md`.

```sh
# Configure .env conforme .env.example e a documentação local
scripts/local.sh up
scripts/local.sh validate
scripts/local.sh status
```

Consulte `docs/STATUS.md` para o estado validado de cada entrega.

## Finalização funcional M1

Contatos e criação manual interna publicados e homologados pelo usuário. [Relatório e evidências](docs/M1_CONTACTS_CONVERSATION_CREATION.md). Fonte de estado vigente: [aceite final](docs/M1_FINAL_ACCEPTANCE.md); encerramento administrativo Git pendente.
