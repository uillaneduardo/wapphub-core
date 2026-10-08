# Arquitetura do WappHub

## 1. Visão geral

O ecossistema é composto inicialmente por três repositórios:

| Repositório | Responsabilidade |
|---|---|
| `wapphub-core` | Backend, domínio, persistência, segurança, realtime, integrações e API |
| `wapphub-chat` | Operação de atendimento |
| `wapphub-platform` | WappHub Admin + Minha Conta |

A separação é de responsabilidade e ciclo de evolução. Não implica microserviços.

Um futuro aplicativo Android nativo deverá consumir os mesmos contratos do Core, sem duplicar regras de domínio.

## 2. Arquitetura inicial

O Core deve ser implementado como **monólito modular**.

Processos de execução previstos:
- API HTTP;
- Realtime Gateway/WebSocket;
- Worker assíncrono.

Eles podem compartilhar o mesmo código/imagem e escalar separadamente quando necessário.

Fluxo conceitual:

```
Clientes Web / Android futuro
        │
        ├─ REST /api/v1
        └─ Realtime/WebSocket
                ↓
           WappHub Core
      ┌─────────┼──────────┐
      │         │          │
     API     Realtime    Worker
      │         │          │
      └──── Application ───┘
                ↓
              Domain
                ↓
      Repositories / Ports
      ├─ MariaDB
      ├─ Redis
      ├─ Object Storage
      └─ Providers externos
```

Controllers não devem conter regra de negócio relevante.

## 3. Multi-tenancy

O WappHub é multiempresa desde a fundação.

- `User`: identidade global.
- `Organization`: tenant.
- `Membership`: relação User ↔ Organization.
- O contexto atual de organização determina dados, permissões, configurações e entitlements.
- Toda consulta tenant-scoped deve filtrar pela organização autorizada.
- Nunca confiar em `organizationId` enviado pelo cliente sem validar Membership ativa.

Pipeline mínimo de autorização:

```
Authentication
  ↓
Organization Context
  ↓
Active Membership
  ↓
RBAC Permission
  ↓
Organization Entitlement
  ↓
Provider Capability (quando aplicável)
  ↓
Business Rule
```

## 4. Identidade e sessão

Login é global por usuário.

Após autenticação:
- se houver uma única organização acessível, ela pode ser selecionada automaticamente;
- se houver várias, o usuário escolhe;
- o usuário pode alternar a organização durante a sessão;
- a troca de organização invalida todos os dados/cache tenant-scoped e muda os escopos realtime.

Perfis pertencem à Membership, não ao User.

Para a aplicação web, a preferência é sessão server-side revogável por cookie seguro. Clientes nativos terão fluxo apropriado documentado separadamente, mantendo revogação e regras server-side.

Detalhes: `docs/SECURITY_PRIVACY.md`.

## 5. RBAC

Perfis padrão iniciais:
- OWNER
- SUPERVISOR
- AGENT

O código não deve espalhar verificações por nome de perfil. Regras devem ser expressas por permissions.

## 6. Catálogo e entitlements

A aplicação nunca deve liberar funcionalidade por nome de plano.

Proibido:

```ts
if (plan.name === "Advanced") { ... }
```

Fluxo:

```
Product
  ↓
Plan
  ↓
PlanFeature
  ↓
Subscription
  + Add-ons
  + Organization Overrides
  ↓
Entitlement Resolver
  ↓
Effective Entitlements
```

Tipos iniciais:
- BOOLEAN
- QUANTITY
- USAGE
- CONFIG

## 7. Assentos

`users.seats` é um recurso quantitativo.

Regra inicial:
- convite pendente não consome;
- Membership ativa e marcada como consumidora de assento consome 1;
- Membership suspensa/revogada não consome;
- o mesmo User pode consumir um assento em cada Organization da qual participe.

## 8. Conversas e mensagens

Conversas, mensagens normalizadas, atribuições, tags, notas e mídia pertencem ao WappHub.

A Meta não é o banco de domínio.

Mensagens devem suportar:
- `clientMessageId` para UI otimista/idempotência do cliente;
- `messageId` WappHub;
- `providerMessageId` externo;
- estados locais/remotos;
- retry/reconciliação.

Histórico e inbox usam paginação por cursor, não OFFSET profundo.

## 9. Realtime

O Chat é realtime-first.

- REST para consultas/comandos/bootstrap;
- WebSocket para eventos operacionais;
- sem polling frequente como estratégia principal;
- eventos segmentados por Organization/conversa/usuário;
- sem broadcast global;
- reconexão com recuperação de eventos perdidos.

Detalhes: `docs/REALTIME_AVAILABILITY.md`.

## 10. Processamento assíncrono

Chamadas externas e webhooks devem suportar padrões Outbox/Inbox/IntegrationEvent.

Objetivos:
- idempotência;
- retry;
- tolerância a falha de processo;
- resposta rápida de webhook;
- desacoplamento da latência da Meta.

## 11. Providers e Meta

O domínio depende de ports, não da Meta diretamente.

```
MessagingProvider
  └─ MetaWhatsAppProvider
```

Cada Organization configura sua própria integração Meta e seus próprios canais/credenciais.

Webhook físico pode ser compartilhado, mas todo evento deve ser resolvido para Organization + Channel antes de processamento de domínio.

Detalhes: `docs/META_INTEGRATION.md`.

## 12. Diagnóstico e capabilities

Toda integração externa deve oferecer diagnóstico estruturado.

Separar:
- Permission;
- Entitlement;
- Provider Capability;
- Channel Configuration;
- Health.

Não representar integração somente como "conectada/desconectada".

Detalhes: `docs/INTEGRATION_DIAGNOSTICS.md`.

## 13. Mídia e storage

Mídia deve usar abstração de object storage.

Quando possível, Core autoriza e registra enquanto o object storage transporta arquivos, evitando manter arquivos grandes em memória da API.

Mídia sempre permanece tenant-scoped e associada ao contexto da conversa/mensagem.

## 14. API e clientes

API versionada desde a fundação:

```
/api/v1/...
```

OpenAPI é o contrato REST oficial.

O realtime também precisa de contrato documentado/versionado.

O futuro Android nativo deve reutilizar estes contratos.

Detalhes: `docs/API_CLIENTS.md`.

## 15. Performance e disponibilidade

O Core deve ser stateless onde possível e permitir múltiplas instâncias futuramente.

Redis pode suportar cache, sessão, pub/sub, presença efêmera, rate limiting, locks e filas; não é fonte da verdade de conversas.

A arquitetura deve ser testada para baseline inicial de ~100 agentes simultâneos antes de considerar microserviços.

Detalhes: `docs/PERFORMANCE_BASELINE.md`.

## 16. Auditoria e observabilidade

Separar:
- **Application Log**: diagnóstico técnico;
- **Audit Event**: ação humana/administrativa;
- **Security Event**: evento de autenticação/segurança;
- **Integration Event**: provider externo.

Erros de infraestrutura não devem vazar códigos internos de ORM, stack traces ou segredos ao cliente.

## 17. Segurança e privacidade

Segurança multi-tenant, sessão revogável, proteção de segredos, sanitização de logs, retenção e privacy by design são requisitos de fundação, não hardening opcional tardio.

Detalhes: `docs/SECURITY_PRIVACY.md`.

## 18. Rotas

Frontends usam URLs reais visíveis na barra de navegação.

O Chat deverá usar History API/BrowserRouter e o servidor precisa suportar SPA fallback para refresh em rotas profundas.

## 19. Evolução

Não introduzir microserviços, event bus distribuído, CQRS ou Kubernetes sem necessidade comprovada e decisão arquitetural registrada.

A arquitetura deve permitir escalar API e Worker horizontalmente sem reescrever o domínio.

## 20. Implementação M0

A implementação usa Node 22 + TypeScript + Fastify 5, Prisma 6 + MariaDB 11.4 e
Redis 7.4. Controllers/contratos ficam em `src/http`, casos de uso e autorização
em `src/application`, erros em `src/domain`, configuração/conexões/criptografia
em `src/infrastructure`. `src/realtime` reserva o envelope futuro.

Sessões persistem no MariaDB com hashes de token/CSRF, expiração absoluta,
inatividade e revogação. Redis atende somente rate limiting no M0. A imagem
compartilhada executa API e Worker separadamente via Compose em rede interna;
nenhum job de integração nem domínio operacional é antecipado.

Os papéis globais são definições de permissões: a associação de um User a um
papel ocorre exclusivamente pela Membership. Organization Context exige
Membership ativa e `organization.read`, sem regras por nome de role/plano.
As duas migrations preservam integridade de identidade, vínculos, convites e
contexto de sessão. Audit/Security Events mantêm referências mínimas para
rastreabilidade; não incluem corpos, credenciais ou conteúdo pessoal adicional.

Não houve mudança nas decisões arquiteturais aprovadas. Execução reproduzível,
bootstrap e limites do ambiente estão em `LOCAL_DEVELOPMENT.md`.

## 21. M1 backend interno

`src/application/chat.ts` concentra workflows, autorização e transações do
chat; `src/http/chat-routes.ts` contém validação e DTOs REST. Gateway Fastify
WebSocket usa as sessões revogáveis existentes e Organization Context.
`src/realtime/contract.ts` define eventos versão 1. Não há JWT paralelo.

MariaDB persiste domínio, auditoria e stream na mesma transação. Lock por
Organization ordena as mutações/eventos até commit; Redis pub/sub é somente
notificação, com catch-up persistente após reconexão/perda de sinal. A opção
de serialização por tenant privilegia consistência no M1 e será medida antes
de qualquer meta M5. Sem event bus distribuído ou microserviços.

A política de transferência se aplica tanto ao REST quanto ao realtime/replay.
Limites de histórico não apagam dados. O ambiente M1 de teste possui projeto,
banco, Redis, volumes, imagem e porta próprios; não participa da ingress de
produção. Produção permanece M0 até uma promoção futura explicitamente revisada.
Decisões e limites detalhados em `M1_CHAT_INTERNAL.md` e `REALTIME_CONTRACT.md`.
