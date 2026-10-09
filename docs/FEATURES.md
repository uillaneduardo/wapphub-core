# Estratégia de Recursos e Entitlements

> Este catálogo define evolução comercial, não declara Entitlement Resolver implementado no M1. Entitlements/assentos e Admin permanecem M2; Meta M3 e mídia M4. Estado M1: [aceite final](M1_FINAL_ACCEPTANCE.md).

## Objetivo

Permitir adicionar recursos e alterar ofertas comerciais sem espalhar regras por plano no código.

## Feature Codes iniciais

### Mensagens
- `chat.text`
- `chat.image`
- `chat.audio`

### Conversas
- `conversation.assignment`
- `conversation.auto_assignment`
- `conversation.transfer`
- `conversation.internal_notes`
- `conversation.tags`
- `conversation.archive`
- `conversation.supervision`

### Mídia
- `media.image`
- `media.audio`

### Capacidade
- `users.seats`
- `channels.whatsapp`

## Futuro, não MVP
- `chat.video`
- `media.video`
- `whatsapp.status`
- `calling.audio`
- `calling.video`
- marketing e automações avançadas

## Tipos

- BOOLEAN: habilitado/desabilitado
- QUANTITY: quantidade contratada
- USAGE: consumo por período
- CONFIG: valor de configuração comercial

## Resolver

O entitlement efetivo deve considerar:

```
Plan Feature
+ Subscription Add-ons
+ Organization Overrides
= Effective Entitlement
```

O Chat e Platform não devem inferir entitlement por plano.

## Segurança

Frontend pode ocultar/desabilitar controles, mas backend revalida entitlement em toda operação protegida.

## Capacidade do provider

Entitlement comercial não garante capacidade técnica externa.

Para recursos dependentes da Meta:

```
Permission
AND Entitlement
AND Provider Capability
AND Business Rule
```

são necessários para executar a operação.

## Adição de novo recurso

Checklist obrigatório:

1. Definir feature code estável.
2. Registrar objetivo e tipo.
3. Implementar comportamento de domínio/aplicação.
4. Proteger endpoint/use case por entitlement quando necessário.
5. Registrar Feature no catálogo.
6. Vincular a planos pelo Admin, não por hardcode.
7. Implementar comportamento frontend para disponível/indisponível.
8. Adicionar auditoria.
9. Testar organização com e sem entitlement.
10. Atualizar documentação e STATUS.

## M2.1 — catálogo e overrides de Membership

Implementação aditiva, restrita a recursos base e RBAC tenant-scoped.
Contrato REST, resolvedor, concorrência/auditoria e controle realtime 4003 descritos
em [M2_1_RESOURCES_RBAC.md](M2_1_RESOURCES_RBAC.md). Nenhum módulo comercial ou
integração Meta implementado. Diagnóstico anterior ao schema em
[M2_1_RBAC_DIAGNOSIS.md](M2_1_RBAC_DIAGNOSIS.md).
