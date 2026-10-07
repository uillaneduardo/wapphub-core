# Integração Meta por Organization

## Regra central

Cada Organization configura e utiliza sua própria integração com a Meta.

Não existe uma credencial Meta compartilhada globalmente pela WappHub para todas as contratantes.

## Relação conceitual

```
Organization
  └─ MetaIntegration
      └─ WhatsAppChannel(s)
```

Uma Organization pode possuir múltiplos canais, limitado por entitlement.

## MetaIntegration

Pertence a exatamente uma Organization.

Responsabilidades conceituais:
- referência à conta/business da Meta;
- credenciais necessárias à API;
- estado da integração;
- data da última validação;
- capabilities descobertas;
- metadados de diagnóstico.

## Channel

Um canal representa um número/endpoint operacional WhatsApp.

Campos conceituais:
- organizationId;
- integrationId;
- provider;
- phoneNumberId;
- displayPhoneNumber;
- verifiedName;
- status.

`providerPhoneNumberId` deve resolver inequivocamente Organization + Channel.

## Entitlement

`channels.whatsapp` define quantos canais a Organization pode ativar.

Separar:
- permitido pelo plano;
- configurado;
- ativo;
- saudável.

## Credenciais

Nunca solicitar senha da conta Meta do cliente.

Usar somente mecanismos oficialmente necessários de autorização/tokens/IDs.

Quando possível, preferir fluxo oficial de autorização/embedded signup em vez de entrada manual de segredos.

Segredos:
- criptografados em repouso;
- nunca logados;
- nunca retornados integralmente ao frontend;
- nunca exibidos em auditoria;
- acessíveis somente ao componente que chama o provider.

## Webhook

O endpoint físico pode ser compartilhado entre Organizations.

Fluxo:

```
Meta
  ↓
Webhook WappHub
  ↓
validar evento
  ↓
resolver provider identifier
  ↓
Channel
  ↓
Organization
  ↓
persistir IntegrationEvent
  ↓
processar no tenant correto
```

Nenhum processamento de domínio ocorre antes de resolver Organization + Channel.

## Conversas

Conversation sempre pertence à Organization e ao Channel.

Isso permite múltiplos números:
- Comercial;
- Suporte;
- Financeiro;
- outros.

## Provider abstraction

O domínio depende de uma interface `MessagingProvider`.

Implementação inicial:
- MetaWhatsAppProvider.

Futuros providers não devem exigir reescrever Conversation/Message.

## Capability

Entitlement comercial e capacidade técnica são separados.

Para uma operação externa:

```
Permission
AND Entitlement
AND Provider Capability
AND Channel Configuration
AND Business Rule
```

devem permitir a ação.
