# Realtime, Disponibilidade e Processamento Assíncrono

## Objetivo

O WappHub Chat deve se comportar como uma aplicação de mensagens em tempo real, não como um CRUD com polling.

## Transporte

Usar dois canais complementares:

- REST para comandos, consultas, bootstrap, histórico e configuração;
- WebSocket para eventos em tempo real.

Polling frequente não é o mecanismo primário de atualização de conversas.

## Core stateless

A API deve ser projetada para permitir múltiplas instâncias futuramente.

Não armazenar como fonte da verdade em memória do processo:
- sessões;
- filas;
- presença;
- histórico de mensagens;
- locks distribuídos.

Estado compartilhado deve usar banco/Redis/infra apropriada.

## Redis

Usos previstos:
- sessão/cache quando aplicável;
- pub/sub de realtime;
- presença efêmera;
- rate limiting;
- locks;
- suporte a filas.

Redis não é fonte oficial de conversas/mensagens.

## Eventos realtime

Eventos tenant-scoped, por exemplo:
- conversation.created
- conversation.updated
- message.created
- message.updated
- assignment.changed
- tag.added
- note.created

Todo evento carrega organizationId e identificadores mínimos necessários.

Nunca fazer broadcast global de eventos para todos os agentes.

Escopos lógicos previstos:
- organization:{organizationId}
- conversation:{conversationId}
- user:{userId}

## Reconexão e sincronização

WebSocket não é confiável como histórico.

O cliente deve conseguir recuperar eventos perdidos após reconexão.

Modelo conceitual:
- eventId monotônico/ordenável;
- organizationId;
- type;
- entityId;
- occurredAt;
- payload/version.

Cliente mantém lastEventId e solicita sincronização quando necessário.

## Mensagens e UI otimista

Enviar mensagem não deve bloquear a interface esperando resposta da Meta.

Identificadores:
- clientMessageId: criado no cliente;
- messageId: WappHub;
- providerMessageId: provider externo.

Estados previstos:
- LOCAL/PENDING
- QUEUED
- SENT
- DELIVERED
- READ
- FAILED

A UI mostra a mensagem imediatamente e reconcilia status posteriormente.

## Outbox

Para operações externas, persistir mudança de domínio e intenção de envio de forma transacional.

Fluxo:

1. persistir Message;
2. persistir OutboxEvent;
3. commit;
4. worker processa;
5. provider é chamado;
6. status é reconciliado.

Objetivo: evitar inconsistência entre banco e chamadas externas.

## Inbox/Integration Events

Webhook externo deve:
1. ser validado;
2. ser persistido/idempotentemente registrado;
3. receber resposta rápida;
4. ser processado assincronamente.

Eventos duplicados do provider não podem duplicar mensagens.

## API e Worker

O mesmo repositório poderá produzir processos separados:
- core-api;
- core-worker.

Mesma base de código e imagem, responsabilidades de execução diferentes.

Isso não transforma o sistema em microserviços.

## Filas e fairness

Jobs carregam organizationId e channelId.

Uma Organization com backlog não deve bloquear outras. A implementação deve permitir concorrência e rate limiting por tenant/provider.

## Escala inicial

A arquitetura deve suportar ao menos o baseline de teste de 100 agentes simultâneos sem exigir microserviços.

Antes de lançamento comercial, medir:
- WebSockets simultâneos;
- eventos/s;
- latência p50/p95/p99;
- uso de CPU/RAM;
- queries SQL;
- atraso de fila;
- reconexões;
- uploads concorrentes.

## Metas internas iniciais

São metas de engenharia, não SLA comercial:
- ação local percebida: imediata/otimista;
- realtime interno normal: alvo < 250 ms;
- API p95 normal: alvo < 500 ms;
- fila sem pressão: atraso alvo < 1 s.

A entrega externa continua sujeita à Meta e à rede.
