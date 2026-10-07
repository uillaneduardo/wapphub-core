# Diagnóstico de Integrações e Capabilities

## Objetivo

Permitir ao cliente e ao suporte identificar rapidamente se um recurso está:
- contratado;
- permitido ao usuário;
- configurado;
- suportado pela Meta;
- operacional.

Não usar apenas um booleano "conectado".

## Níveis de validação

### Configuração
Verifica presença/consistência estrutural dos dados necessários.

### Autenticação
Valida se a credencial consegue autenticar no provider.

### Recursos do provider
Confirma acesso à conta/business/número configurados.

### Webhook
Valida configuração e recebimento de eventos.

### Comunicação
Valida saída e entrada.

### Recurso funcional
Valida texto, imagem, áudio e outros recursos individualmente.

## Capability Matrix

Resultado efetivo é explicável:

| Dimensão | Pergunta |
|---|---|
| Permission | o usuário pode executar? |
| Entitlement | a Organization contratou? |
| Provider Capability | a Meta permite/suporta? |
| Channel Configuration | o canal está configurado? |
| Health | componentes necessários estão saudáveis? |

## Estados

Usar estados, não apenas true/false:
- UNKNOWN
- CHECKING
- HEALTHY
- DEGRADED
- FAILED
- DISABLED

## Códigos estáveis

Exemplos:
- META_AUTH_OK
- META_AUTH_INVALID
- META_WABA_ACCESS_OK
- META_WABA_ACCESS_DENIED
- META_PHONE_FOUND
- META_PHONE_NOT_FOUND
- WEBHOOK_CONFIGURED
- WEBHOOK_UNREACHABLE
- MESSAGE_SEND_OK
- MESSAGE_SEND_FAILED
- MESSAGE_RECEIVE_OK
- MEDIA_IMAGE_OK
- MEDIA_AUDIO_OK

Frontend recebe códigos WappHub e mensagens seguras, não erro bruto da Meta.

## Diagnostic Run

Registrar execuções diagnósticas:
- organizationId;
- channelId;
- triggeredBy: USER | SUPPORT | AUTO;
- startedAt;
- finishedAt;
- status;
- checks;
- durationMs.

Manter histórico suficiente para suporte e análise.

## Light Health Check

Barato e frequente:
- Core;
- banco;
- Redis;
- worker;
- fila;
- último webhook;
- último envio;
- último erro;
- validade recente da integração.

Não chamar a Meta desnecessariamente a cada execução.

## Deep Diagnostic

Sob demanda ou em cadência maior:
- validar credencial;
- validar conta;
- validar número;
- atualizar capabilities;
- validar webhook;
- executar teste controlado quando aplicável.

## Teste ponta a ponta

Modo diagnóstico pode acompanhar:

```
Meta → Webhook → Core → Banco → Realtime → Chat
```

e:

```
Chat → Core → Outbox/Queue → Worker → Meta → Status
```

Registrar tempos por etapa quando possível.

## Saúde da fila

Monitorar:
- waiting;
- processing;
- failed;
- oldestJobAge;
- throughput.

Uma API saudável com worker/fila degradada não deve ser reportada como integração plenamente saudável.

## Segurança

Suporte pode ver saúde e códigos de erro, mas não segredos completos.
