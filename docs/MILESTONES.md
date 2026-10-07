# Milestones do WappHub

Os milestones são sequenciais. Um milestone não deve ser considerado concluído enquanto seus critérios de aceite não forem atendidos e `STATUS.md` não for atualizado.

## M0 — Fundação

Objetivo: estabelecer base segura para desenvolvimento.

Entregas:
- estrutura inicial do Core;
- configuração TypeScript/runtime;
- Prisma + MariaDB;
- migrations;
- User;
- Organization;
- Membership;
- OrganizationInvitation;
- Role/Permission;
- sessão/autenticação;
- contexto de Organization;
- tratamento padronizado de erros;
- AuditEvent básico;
- testes de isolamento multi-tenant;
- contrato inicial de API;
- documentação executável/local.

Critério de aceite:
- usuário autentica;
- consulta organizações das quais participa;
- seleciona/troca contexto;
- backend impede acesso a organização sem Membership ativa;
- Owner/Supervisor/Agent possuem permissions iniciais resolvidas;
- rotas base respondem com erros de domínio estáveis.

## M1 — Chat interno independente da Meta

Objetivo: validar o domínio operacional sem dependência externa.

Entregas:
- Contacts;
- Conversations;
- Messages simuladas/internas;
- Tags;
- Notes;
- arquivamento;
- atribuição manual;
- transferência;
- supervisão;
- frontend Chat com rotas reais;
- seleção/troca de Organization;
- UI inicial por permissions.

Critério de aceite:
- duas organizações permanecem isoladas;
- usuário com Memberships múltiplas alterna contexto;
- conversa pode ser criada, atribuída, transferida, tageada, anotada e arquivada;
- refresh em rota profunda do frontend funciona.

## M2 — SaaS e Entitlements

Objetivo: controlar comercialmente acesso e limites.

Entregas:
- Product;
- Plan;
- Feature;
- PlanFeature;
- Subscription;
- Add-ons;
- Overrides;
- Entitlement Resolver;
- `users.seats`;
- `channels.whatsapp`;
- fluxo de convite condicionado a assentos;
- WappHub Admin mínimo;
- Minha Conta mínimo;
- plano com preço zero suportado.

Critério de aceite:
- Admin cria produto/plano/recurso;
- associa recursos ao plano sem alteração de código;
- cria assinatura para Organization;
- entitlement efetivo é resolvido;
- convite aceito só ativa Membership quando existe assento;
- organização WappHub pode usar plano interno de R$ 0,00.

## M3 — Integração Meta / WhatsApp

Objetivo: substituir mensagens simuladas por mensagens reais do provider.

Entregas:
- Channel WhatsApp;
- armazenamento seguro de credenciais;
- MetaWhatsAppProvider;
- webhook;
- idempotência;
- IntegrationEvent;
- TEXT bidirecional;
- status básico de mensagens;
- diagnóstico de integração.

Critério de aceite:
- mensagem recebida no WhatsApp aparece na Organization correta;
- resposta enviada pelo Chat chega ao WhatsApp;
- webhook repetido não duplica mensagem;
- falha externa não expõe detalhes internos ao usuário.

## M4 — Mídia MVP

Objetivo: completar capacidades mínimas de atendimento.

Entregas:
- IMAGE;
- AUDIO;
- object storage;
- Media;
- upload/download;
- gerenciador de arquivos;
- limites por entitlement quando definidos.

Critério de aceite:
- imagem e áudio funcionam nos dois sentidos;
- mídia permanece associada à conversa e organização;
- acesso entre tenants é impossível.

## M5 — MVP Comercializável

Objetivo: fechar fluxo completo de uso real.

Entregas:
- refinamento de onboarding;
- atribuição automática round-robin;
- supervisão final;
- diagnóstico;
- auditoria mínima completa;
- hardening de segurança;
- documentação de deploy;
- smoke tests;
- experiência Owner/Supervisor/Agent;
- validação da própria WappHub como organização cliente.

Critério de aceite:
- fluxo completo produto → plano → assinatura → convite → assento → atendimento WhatsApp funciona sem intervenção no banco;
- WappHub consegue operar internamente usando a mesma arquitetura oferecida a clientes.

## Pós-MVP

Não implementar sem novo milestone:
- vídeo;
- Status;
- chamadas;
- marketing;
- IA;
- chatbot;
- CRM;
- SLA/BI avançado;
- outros canais;
- billing recorrente completo;
- SSO;
- apps nativos.
