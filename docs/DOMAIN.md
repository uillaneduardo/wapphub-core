# Modelo de Domínio Inicial

Este documento define entidades e relações conceituais. O schema físico poderá evoluir durante o milestone de implementação, desde que preserve estas regras.

## Identidade

### User
Identidade global da pessoa no WappHub.

Não possui `organizationId` nem `role` globais.

Campos conceituais:
- id
- name
- email
- password/authentication data
- status
- createdAt
- updatedAt

### Organization
Empresa/tenant que utiliza produtos WappHub.

### Membership
Vínculo entre User e Organization.

Campos conceituais:
- id
- userId
- organizationId
- roleId
- status
- consumesSeat
- joinedAt

Um User pode possuir várias Memberships.

## Convites

### OrganizationInvitation
- organizationId
- email
- roleId
- invitedByUserId
- status: PENDING | ACCEPTED | EXPIRED | CANCELLED
- tokenHash
- expiresAt
- acceptedAt

Aceitação deve validar o endereço convidado.

## Autorização

### Role
Perfis padrão iniciais:
- OWNER
- SUPERVISOR
- AGENT

### Permission
Capacidade autorizativa granular.

### RolePermission
Relação Role ↔ Permission.

## Catálogo comercial

### Product
Ex.: WappHub Chat.

### Feature
Capacidade comercial/técnica.

Campos:
- code estável
- name
- description
- type
- status: DRAFT | ACTIVE | DEPRECATED | DISABLED

### Plan
Oferta comercial de um Product.

Preço pode ser zero.

### PlanFeature
Configura a disponibilidade/quantidade de uma Feature em um Plan.

### Subscription
Assinatura de uma Organization.

Status inicial previsto:
- ACTIVE
- SUSPENDED
- CANCELLED
- EXPIRED

Estados adicionais poderão ser adicionados quando billing/trial forem realmente implementados.

### SubscriptionAddon
Recursos/quantidades adicionais associados à assinatura.

### OrganizationFeatureOverride
Exceção administrativa auditável de entitlement.

Operações previstas:
- ENABLE
- DISABLE
- SET
- ADD

## Entitlements

Entitlement não precisa ser persistido como fonte da verdade; pode ser resolvido a partir de:
- PlanFeature
- SubscriptionAddon
- OrganizationFeatureOverride

O resolver expõe capacidades efetivas da Organization.

## Operação do Chat

### Channel
Canal externo configurado por Organization.

Inicialmente:
- WHATSAPP_META

### Contact
Contato pertencente à Organization.

### Conversation
Conversa pertencente à Organization. No M1 interno, referencia Contact e não
possui Channel/provider. Channel pertence ao escopo da integração externa futura.

Estados mínimos:
- OPEN
- PENDING
- ARCHIVED

### Message
Mensagem normalizada.

No M1: apenas INTERNAL/TEXT, UUID WappHub e clientMessageId por
Organization/Conversation. Não há providerMessageId obrigatório. IMAGE/AUDIO
e identificadores externos pertencem aos milestones de provider/mídia.

### ConversationAssignment
Registra atribuição/transferência e escopo de histórico.

Modos:
- FULL
- LIMITED
- NONE

### Tag
Pertence à Organization.

### ConversationTag
Relação Conversation ↔ Tag.

### ConversationNote
Nota interna não enviada ao provider.

### Media
Arquivo associado a Message/Conversation e armazenado sob controle do WappHub.

## Auditoria

### AuditEvent
Ações humanas/administrativas.

### IntegrationEvent
Eventos externos e processamento de integração.

## Regra central

Todo dado operacional deve ser resolvido dentro de uma Organization autorizada. Nunca permitir leitura cruzada entre tenants.

## Modelo físico entregue no M1 backend

Contact, Conversation, Message, Tag, ConversationTag, InternalNote,
ConversationAssignmentHistory e RealtimeEvent são persistidos no MariaDB.
Relações operacionais usam FKs compostas com organizationId. User continua
identidade global; atribuição não cria role ou organizationId global em User.
FULL/LIMITED/NONE são limites de autorização persistidos na Conversation;
histórico original nunca é copiado/apagado. Recibos locais, permissions,
cursores e limites deste escopo estão em `M1_CHAT_INTERNAL.md`.
