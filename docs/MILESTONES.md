# Milestones do WappHub

Os milestones são sequenciais. Um milestone não deve ser considerado concluído enquanto seus critérios de aceite não forem atendidos e `STATUS.md` não for atualizado.

## M0 — Fundação

Objetivo: estabelecer uma base segura, multi-tenant e preparada para clientes web e futuros clientes nativos.

Entregas:
- estrutura inicial do Core;
- TypeScript/runtime;
- Prisma + MariaDB;
- migrations;
- User;
- Organization;
- Membership;
- OrganizationInvitation;
- Role/Permission;
- autenticação;
- sessão server-side web revogável;
- contexto de Organization;
- tratamento padronizado de erros;
- AuditEvent básico;
- SecurityEvent básico;
- rate limiting de autenticação;
- proteção CSRF/CORS/headers conforme arquitetura web;
- isolamento multi-tenant testado;
- sanitização de logs;
- base de proteção/criptografia de segredos;
- API versionada em `/api/v1`;
- OpenAPI inicial;
- contrato inicial de realtime/eventos;
- estrutura que permita API + Worker;
- Redis disponível para responsabilidades aprovadas;
- documentação executável/local.

Critério de aceite:
- usuário autentica;
- consulta organizações;
- seleciona/troca contexto;
- sessão pode ser revogada;
- backend impede acesso sem Membership ativa;
- permissions são resolvidas pela Membership;
- tenant A não acessa recursos de tenant B;
- endpoints sensíveis possuem proteção básica contra abuso;
- erros/segredos internos não vazam na API;
- contrato `/api/v1` está documentado.

## M1 — Chat interno independente da Meta

Objetivo: validar domínio e experiência realtime sem provider externo.

Entregas:
- Contacts;
- Conversations;
- Messages internas;
- `clientMessageId`;
- status locais;
- Tags;
- Notes;
- arquivamento;
- atribuição manual;
- transferência;
- supervisão;
- frontend Chat com rotas reais;
- seleção/troca de Organization;
- UI por permissions;
- REST + WebSocket;
- eventos tenant-scoped;
- reconexão/sincronização;
- paginação por cursor;
- UI otimista;
- bootstrap da aplicação;
- baseline visual/design tokens.

Critério de aceite:
- Organizations permanecem isoladas;
- usuário multi-Organization alterna contexto sem vazamento visual/realtime;
- conversa pode ser criada, atribuída, transferida, tageada, anotada e arquivada;
- duas sessões observam atualização realtime coerente;
- queda/reconexão não perde estado persistido;
- refresh em rota profunda funciona.

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
- plano com preço zero;
- `accentColor`/personalização básica por Organization quando aplicável.

Critério de aceite:
- Admin cria produto/plano/recurso;
- associa recursos ao plano sem alteração de código;
- cria assinatura;
- entitlement efetivo é explicável;
- convite aceito só ativa Membership quando existe assento;
- WappHub pode usar plano interno R$ 0,00.

## M3 — Integração Meta / WhatsApp

Objetivo: operar texto real usando integração própria de cada Organization.

Entregas:
- MetaIntegration tenant-scoped;
- Channel WhatsApp;
- armazenamento criptografado de segredos;
- MetaWhatsAppProvider;
- webhook compartilhável com resolução segura de Organization + Channel;
- Inbox/IntegrationEvent;
- Outbox/Worker;
- idempotência;
- TEXT bidirecional;
- estados de mensagem;
- validação de credenciais;
- validação de WABA/número;
- capability matrix;
- light health check;
- deep diagnostic;
- diagnóstico de webhook;
- saúde da fila;
- teste funcional de texto;
- histórico de Diagnostic Runs.

Critério de aceite:
- duas Organizations usam credenciais Meta distintas;
- mensagem recebida é resolvida para tenant/canal correto;
- resposta chega ao WhatsApp;
- webhook repetido não duplica mensagem;
- falha de uma Organization/provider não bloqueia outra;
- diagnóstico identifica a etapa com falha sem expor segredo.

## M4 — Mídia MVP

Objetivo: entregar experiência de imagem e áudio próxima de um mensageiro moderno.

Entregas:
- IMAGE;
- AUDIO;
- object storage abstrato/S3-compatible;
- Media;
- upload/download autorizado;
- gerenciador de arquivos;
- mídia da conversa;
- visualização ampliada de imagem;
- gravação de áudio no Chat web;
- preview/player de áudio;
- normalização de mídia quando necessária;
- processamento assíncrono;
- diagnóstico funcional de imagem/áudio.

Critério de aceite:
- imagem e áudio funcionam nos dois sentidos;
- envio não bloqueia UI;
- mídia permanece associada ao tenant/conversa/mensagem;
- "ir para mensagem" preserva contexto;
- acesso cross-tenant é impossível.

## M5 — MVP Comercializável

Objetivo: fechar fluxo completo e validar disponibilidade/segurança.

Entregas:
- onboarding;
- atribuição automática round-robin;
- supervisão final;
- diagnóstico operacional;
- auditoria mínima completa;
- security/privacy hardening final;
- documentação de deploy;
- backups/restore testados;
- healthchecks;
- smoke tests;
- baseline de carga para ~100 agentes;
- experiência Owner/Supervisor/Agent;
- validação da própria WappHub como Organization cliente.

Critério de aceite:
- fluxo produto → plano → assinatura → convite → assento → integração → atendimento funciona sem intervenção no banco;
- WappHub opera internamente usando a mesma arquitetura;
- carga/realtime possuem métricas registradas;
- falhas comuns possuem diagnóstico acionável.

## Pós-MVP

Não implementar sem milestone próprio:
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
- app Android nativo.

### Android nativo

Embora pós-MVP, a API atual deve permanecer preparada desde M0/M1 para um cliente Android:
- contratos versionados;
- OpenAPI;
- realtime documentado;
- paginação por cursor;
- clientMessageId/idempotência;
- autenticação móvel desenhável sem alterar domínio.
