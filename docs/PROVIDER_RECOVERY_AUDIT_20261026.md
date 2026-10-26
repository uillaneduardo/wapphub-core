# A0 — Auditoria inicial do Provider Web: recuperação e histórico (Issue #59)

Data: 2026-10-26. Status: **auditoria estática inicial; implementação funcional e testes de integração pendentes**.

## Sintoma reportado
- Sessão `FAILED / SYNC_BACKPRESSURE`; aproximadamente um dia sem mensagens.
- Reinício do container e desvinculação/revinculação não recuperaram o intervalo offline.
- Nenhum log do homelab foi anexado a esta auditoria; não atribuir causa definitiva sem instrumentação.

## Pontos de código inspecionados na main
1. `services/wapphub-provider-web/src/main.ts`: flags `PROVIDER_SYNC_ENABLED`, `PROVIDER_INITIAL_HISTORY_ENABLED`, `PROVIDER_HISTORY_ENABLED`, `PROVIDER_HISTORY_EXECUTION_ENABLED`, `PROVIDER_HISTORY_SCOPED_AUTHORIZATION`, `PROVIDER_HISTORY_APPROVED_SCOPE`, `PROVIDER_LINKED_RECOVERY_ONLY`.
2. `services/wapphub-provider-web/src/baileys.ts`: `syncFullHistory` limitado a bootstrap de primeiro vínculo; `shouldSyncHistoryMessage: () => false`; eventos `messaging-history.set` e `messages.upsert` filtrados por elegibilidade; histórico on-demand depende de operação autorizada e limites de leitura.
3. `services/wapphub-provider-web/src/sessions.ts`: `processingFailure` categoriza `SYNC_BACKPRESSURE` como capacidade, fecha socket e persiste `FAILED`; `recoveryEligible` não lista esse código, ao contrário de várias falhas de transporte; `start` tem orçamento finito de reconexão.
4. `docs/WHATSAPP_WEB_CP4_ACCEPTANCE.md`: homologação do tempo real **exclui** histórico anterior à conexão.

## Hipóteses a investigar, ainda não comprovadas
- Backlog não drenado/ACK ou atraso Core/Worker provoca pressão, socket é fechado e o reinício preserva estado FAILED.
- Novo vínculo não dá acesso integral a mensagens já perdidas; o provider pode ignorar notificações de histórico fora das condições de bootstrap.
- Limites de quantidade/janela/tamanho geram importação parcial mesmo quando há histórico disponível.
- Mensagens podem estar capturadas e enfileiradas, mas ainda não persistidas/apresentadas na Inbox.

## Plano de execução segura
### A1 — Recuperação e estado
- Instrumentar last-received/last-persisted, queue depth, storage failures e causa da transição.
- Corrigir elegibilidade de falhas transitórias de capacidade **somente após confirmar drenagem**; incluir política de retry/backoff/jitter e circuit breaker, evitando loop de reconexão sobre fila cheia.
- Testar restart, falha do worker, fila cheia e vault intacto.

### A2 — Histórico e reconciliação
- Catalogar a capacidade efetiva de histórico no Baileys 7.0.0-rc14: bootstrap, on-demand, limites e o que a sessão já vinculada pode solicitar.
- Reconciliar lacunas desde checkpoint com janela sobreposta e IDs estáveis, somente quando o protocolo disponibilizar as páginas.
- Persistir referência antes de processar, reexecutar jobs interrompidos, classificar cobertura COMPLETE/PARTIAL/UNAVAILABLE. Priorizar tempo real.
- Manter limites seguros (memória, bytes, concorrência) e evitar alterar cegamente `shouldSyncHistoryMessage`.

### A3 — Core e Chat
- Verificar fluxos de journal/staging → worker → DB → realtime → Inbox e isolamento por tenant.
- Validar autoria, ordem, dedupe, unread, RBAC, mídia e mensagens enviadas pelo aparelho oficial.
- Criar evidência automatizada e homologação visual de 24 h offline/reconexão.

## Gate de merge funcional
- Testes unitários, integração e recuperação de falhas passando.
- Provas de nenhuma perda adicional/duplicação/re-pareamento forçado.
- Cobertura histórica reporta parcial quando WhatsApp não disponibiliza o conteúdo.
- Runbook, rollback e validação no homelab.

> Este documento **não** implementa autocura nem garante recuperação de mensagens. Não tratar a inclusão deste arquivo na main como entrega funcional.
