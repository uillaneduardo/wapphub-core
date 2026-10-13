# Recuperação rápida WhatsApp Web — 2026-10-13

Autorização explícita: descartar filas/dados do canal afetado, reiniciar processos e reconectar por QR se necessário. Organizações, equipe, memberships, RBAC, outros canais/tenants e credenciais alheias permanecem preservados. Sem envio real automático.

Diagnóstico confirmou 81 lotes bootstrap historical=true em dead-letter, cinco tentativas cada. Core guarda 405 falhas; 32 códigos ativos HISTORY_EXECUTION_DISABLED. A UI mascarava 64 ocorrências como PERSISTENCE_FAILED. Provider aceita bootstrap nativo, mas o Core aplicava o flag on-demand antes da distinção pela correlação scoped. PR37/main41861c4 já estava em produção.

Correção mínima: bootstrapCorrelationId do escopo autenticado permite a ingestão nativa; histórico on-demand mantém flag, grant, permissões e limites existentes. Isolamento, lease, transação e deduplicação permanecem. Novos contactos/conversas live são criados pela ingestão atual. Prioridade live no journal e outbound no Worker já existentes, conservadas. Código HISTORY_EXECUTION_DISABLED permanece específico no diagnóstico.

Regressão reproduzida antes da correção (bootstrap não acked); Core148/148 passaram depois, incluindo Worker com execução histórica desativada, live/bootstrap, replay deduplicado, operação arbitrária/tenant errado rejeitados e lease inválido. Checks lint/typecheck/build/Prisma/contratos em registro local. Nenhuma migration necessária.

Limpeza planejada: snapshot SQL transacional e Vault quiescente; remover apenas eventos/dead letters/checkpoints bootstrap do canal CONNECTED. Preservar auth/Signal/sends/command receipts, mídia, mensagens, contatos/conversas e outros tenants. Comandos outbound pendentes serão explicitamente falhados com resultado incerto se já em PROCESSING; nenhuma retransmissão automática. Sem docker volume rm. Só imagem Core muda; Provider reinicia usando a imagem anterior e identidade vinculada.

Mídia: Core possui metadados de IMAGE/VOICE recebidas, mas Vault contém só três uploads sem referência remota. Consulta a IMAGE recebida retornou404 MEDIA_UNAVAILABLE no Provider, antes de qualquer download. Falha de reprodução não comprovada; a ausência da referência é um impedimento anterior. A validação de directPath no retainer exclui query strings; hipótese para investigar com captura sanitizada de nova mídia, sem expor chaves/URL. Metadados atuais não contêm referência suficiente para recuperar esses downloads. Não se declara conserto de mídia por este ajuste de ingestão.

Emoji picker: melhoria independente, não bloqueia recuperação.

Evidências e entrega operacional: `/home/uillan/homelab/deploy-records/wapphub-core/20261013-whatsapp-recovery/`. Homologação de recebimento/envio e latência ponta a ponta depende de ação humana; nenhuma mensagem automática será enviada. Atualizar relatório após publicação.
