# WhatsApp Web CP4 — publicação técnica, 10/10/2026

Core PR14 integrado em9423b0b; Chat PR11 emcbbc21e e PR12 em0b6b2ee
corrige indicador após drenagem contínua. Implementação canônica limitada,
timestamp/autoria externa/aliases PN-LID, persistência idempotente/retry,
histórico agregado e RBAC/fronteiras administrativos preservados.

Imagens locais do Homelab:

- API/Worker `wapphub-core:cp4-9423b0b`;
- Provider `wapphub-provider-web:cp4-9423b0b`;
- Chat `wapphub-chat:cp4-0b6b2ee`.

115 testes Core,47 Provider,256 Chat; lint/typecheck/build, OpenAPI/Prisma/drift,
audits e CI das PRs/commits das imagens aprovados. Interop em networknone com
imagens reais/contas sintéticas confirma HMAC e batches prioritários/ack.
Sem browser no Homelab. Homologação visual/funcional pelo usuário pendente.

Migration20261010220000_whatsapp_web_bounded_sync aplicada, ledger8→9. Backup
consistente restaurado em banco isolado; dados protegidos e contagens idênticos
após migration, oito checagens tenant sem violações. Snapshot criptografado da
sessão restaurado/decrypt offline e chaves preservadas em pastas restritas.
Mesma conta/tenant/conexão e QR revision verificados somente por booleanos,
sem credenciais/identificadores pessoais nas evidências. Sessão CONNECTED.

Seis serviços healthy,19 verificações HTTP, HMAC/readiness/heartbeat e logs
conferidos,37 containers não relacionados preservados. Provider privado,
read_only/cap_dropALL/backend+egress, sem portas/ingress. Demo ENABLED;
regressão sintética aprovada. Nenhum envio real automático ou pareamento novo.

Carga sintética: SQL1000 mensagens históricas+1 nova+50 lotes reprocessados,
26,1s, CPU13,9s/RSS205MiB, persistência nova100ms, sem duplicação. Journal1001
mensagens com restart,9,2s, CPU5,7s/RSS221MiB, nova439ms, fila/dead finais0.
São medições locais dos processos, não SLA do WhatsApp. Antes do deploy15GB
de disco e~3,9GiB de RAM disponíveis; imagens anteriores preservadas.

Histórico real desativado: nenhuma importação extensa foi disparada. Limite
proposto500 identidades/conversas,1000 mensagens em30dias; autorização operacional
específica segue pendente. WhatsApp pode não reenviar histórico da sessão CP3.
Recebimento contínuo está habilitado; validação funcional real cabe ao usuário.
Envio pelo Chat e download completo de mídia continuam bloqueados; CP5 não iniciado.

Relatório detalhado, arquivos alterados, SHA/IDs das imagens, CI, backups,
medidas, logs, contagens e roteiro de homologação estão no registro local
`~/homelab/deploy-records/wapphub-provider-web/20261010-checkpoint4/RELATORIO.md`.
Rollback em ROLLBACK.md: desativar sync/history mantendo parser CP4, auth/journal/
schema; downgrade CP3 exige drenagem e validação de compatibilidade. Nunca apagar
sessão/dados ou restaurar backup automaticamente para reverter aplicação.

[Contrato, limites, privacidade e operação](WHATSAPP_WEB_CHECKPOINT4.md).
[Core PR14](https://github.com/uillaneduardo/wapphub-core/pull/14),
[Chat PR11](https://github.com/uillaneduardo/wapphub-chat/pull/11),
[Chat PR12](https://github.com/uillaneduardo/wapphub-chat/pull/12).
