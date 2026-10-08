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

**Produção confirmada após P0 em 2026-10-08:** Core/API/Worker
`cbaf50c5eedd6731e1ca3a674c1d9b0b20005a7d`, imagem `wapphub-core:p0-preview-cbaf50c`;
Chat `d93efc576bd560fcbab0146343fb98bbbc1d0b69`, imagem `wapphub-chat:p0-preview-d93efc5`.
Core M1, roster e Demo publicados; correção de prévias autorizadas em produção.
[Registro do deploy](docs/DEPLOY_P0_20261008.md): backup, testes anteriores,
healthchecks, imagens e contingência. Homologação visual desta publicação pendente.

M1 operacional, sem encerramento formal: checkpoint A2 e demais aceites continuam
pendentes. Integração Git ainda exige PRs/revisão; nenhum push ou merge realizado.
Catálogo comercial/entitlements/Admin/Minha Conta continuam no M2 planejado.

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

## Finalização funcional M1 — implementação local

Contatos e criação manual interna validados localmente, ainda sem publicação/homologação. [Relatório e evidências](docs/M1_CONTACTS_CONVERSATION_CREATION.md). Produção informada: Core P0 `cbaf50c`, Chat P1 `6bbc1c4`, ambos homologados pelo usuário. M1 permanece sem encerramento formal.
