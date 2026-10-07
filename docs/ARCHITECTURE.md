# Arquitetura do WappHub

## 1. Visão geral

O ecossistema é composto inicialmente por três repositórios:

| Repositório | Responsabilidade |
|---|---|
| `wapphub-core` | Backend, domínio, persistência, segurança, integrações e API |
| `wapphub-chat` | Operação de atendimento |
| `wapphub-platform` | WappHub Admin + Minha Conta |

A separação é de responsabilidade e ciclo de evolução. Não implica microserviços.

## 2. Arquitetura inicial

O Core deve ser implementado como **monólito modular**.

Fluxo conceitual:

```
HTTP/API
  ↓
Controllers / Routes
  ↓
Application / Use Cases
  ↓
Domain
  ↓
Repositories / Ports
  ↓
Infrastructure
  ├─ MariaDB
  ├─ Redis (quando necessário)
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
- a troca de organização invalida/cacheia novamente todos os dados tenant-scoped.

Perfis pertencem à Membership, não ao User.

## 5. RBAC

Perfis padrão iniciais:

- OWNER
- SUPERVISOR
- AGENT

O código não deve espalhar verificações por nome de perfil. Regras devem ser expressas por permissions.

## 6. Catálogo e entitlements

A aplicação nunca deve liberar funcionalidade por nome de plano.

Proibido como regra de domínio:

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

Tipos iniciais de feature:

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

## 8. Conversas

Conversas, mensagens normalizadas, atribuições, tags, notas e mídia pertencem ao WappHub.

A Meta não é o banco de domínio.

Entrada:

```
Meta Webhook
  ↓
Provider Adapter
  ↓
Integration Event
  ↓
Normalization
  ↓
Message/Conversation Use Case
  ↓
Persistence
```

Saída:

```
User action
  ↓
Message Use Case
  ↓
Messaging Provider Port
  ↓
Meta Adapter
```

## 9. Providers

O domínio deve depender de interfaces/ports, não da Meta diretamente.

Exemplo conceitual:

```
MessagingProvider
  └─ MetaWhatsAppProvider
```

Isso preserva a possibilidade de outros canais futuramente.

## 10. Auditoria e observabilidade

Separar:

- **Application Log**: diagnóstico técnico.
- **Audit Event**: ação humana ou administrativa.
- **Integration Event**: eventos de provedores externos.

Erros de infraestrutura não devem vazar ao frontend como códigos internos de ORM.

## 11. Rotas

Frontends usam URLs reais visíveis na barra de navegação.

O Chat deverá usar History API/BrowserRouter e o servidor precisa suportar SPA fallback para refresh em rotas profundas.

## 12. Evolução

Não introduzir microserviços, event bus distribuído ou CQRS sem necessidade comprovada e ADR aprovada.
