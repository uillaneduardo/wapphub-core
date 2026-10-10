# Baseline de Performance

## Objetivo inicial

A arquitetura deve ser validada para aproximadamente 100 agentes simultâneos antes de exigir qualquer divisão em microserviços.

## Princípios

- WebSocket segmentado por Organization/conversa/usuário;
- sem broadcast global;
- paginação por cursor;
- índices tenant-aware;
- processamento assíncrono;
- API stateless;
- mídia em object storage;
- payloads incrementais;
- debounce/rate limiting em eventos ruidosos.

## Banco

Conversas devem permitir índices equivalentes a:
- organizationId + status + lastMessageAt;
- organizationId + assignedUserId + lastMessageAt.

Mensagens devem permitir acesso eficiente por:
- organizationId + conversationId + createdAt/id.

Não usar OFFSET profundo para histórico de mensagens.

## Paginação

Exemplo:

```
GET /api/v1/conversations/:id/messages?before=<cursor>&limit=50
```

Lista de conversas também usa cursor.

## Mídia

Evitar transportar arquivos grandes pela memória da API quando upload/download direto autorizado ao object storage for possível.

Core autoriza e registra; storage transporta.

## Eventos ruidosos

Typing/presence devem possuir throttling/debounce e TTL.

Não enviar evento por tecla.

## Teste de carga mínimo

Validar:
- 100 sessões/agentes;
- 100+ WebSockets;
- 50–100 eventos/s como baseline de stress inicial;
- histórico grande;
- múltiplas Organizations;
- uploads concorrentes;
- reconexão;
- worker/fila.

Medir:
- CPU;
- RAM;
- p50/p95/p99;
- queries;
- conexões DB;
- filas;
- falhas;
- latência realtime.

Os números finais de infraestrutura devem ser derivados dos testes, não fixados apenas por estimativa.


## CP4 — sincronização sintética medida em 10/10/2026

SQL isolado:1000 históricas+1 nova,50 lotes reprocessados sem duplicação;26,1s,
CPU13,9s/RSS205MiB, nova100ms. Vault/journal:1001 mensagens+restart,51 lotes,
9,2s,CPU5,7s/RSS221MiB,nova439ms,fila/dead finais0. Medidas de processos locais,
sem conta real/mídia/network, não SLA. Evidências core-load.json/provider-load.json
em deploy-records/wapphub-provider-web/20261010-checkpoint4.
