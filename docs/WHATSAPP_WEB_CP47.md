# CP4.7 — histórico automático por conexão e interface administrativa

O CP4 contínuo homologado permanece inalterado. A aquisição remota de histórico é comprovada apenas sinteticamente; o usuário fará a primeira autorização real após a publicação. Baileys instalado e lockfile: 7.0.0-rc14. `fetchMessageHistory` retorna uma solicitação assíncrona, não confirma importação. A origem aceita exclusivamente notificações self-only correlacionadas, do tipo ON_DEMAND, com os limites existentes. Não há enumeração integral de conversas desconhecidas nem `resyncAppState`, novo pareamento, envio pelo Chat ou download binário de mensagens.

## Auditoria e reutilização

| Requisito | Encontrado no CP4.6 | CP4.7 |
|---|---|---|
| sync.batch / SQL / Inbox / realtime / autoria | Implementado | Reutilizado sem segundo pipeline |
| Journal / vault / recibos / cursores / retry / backpressure | Implementado | Reutilizado; encerramento do produtor aguardável |
| Operação persistente e comandos administrativos | Implementado | Mesmos JSON e outbox, sem migration |
| Autorização automática independente do browser | Inadequada: sessão e 15 minutos | Grant persistente scoped com revalidação da membership |
| Coordenação e retomada automática segura | Parcial: preparação/início manuais | Worker agenda e reconcilia a mesma operação |
| Correlação assíncrona | Parcial: ID opcional | ID obrigatório, origem self-only e tipo ON_DEMAND |
| Intervalos e falta de progresso | Parcial | 30 segundos/conexão, 5 minutos/conversa, sem repetir âncora sem avanço |
| Interface comercial | Inadequada: contadores no card principal | Três cards e diagnósticos/gerenciamento expansíveis |

## Autorização e contrato REST

POST `/api/v1/providers/whatsapp-web/connections/{id}/history/authorization`: `commandId`, `expectedVersion`, `action: enable|pause|disable`, `confirmed: true` obrigatório para enable. Confirmação registra usuário, organização, conexão, horário e orçamento fixo de 20 mensagens/30 dias. Requer os quatro direitos existentes e sessão/CSRF/Origin válidos no momento da configuração. Não recebe organizationId do browser.

A ativação cria uma operação limitada pelo outbox; o Worker prepara e inicia sem segundo botão. GET history inclui `operation.authorization` sanitizada (state/authorizedAt); não expõe sessão, âncoras ou payload. Endpoints CP4.6 preservados para compatibilidade; iniciar/retomar exige grant CP4.7. Preparar outra operação após um grant é recusado: não há reposição silenciosa de orçamento.

`ProviderConnection.historyOperation.authorization` guarda escopo, estado, ator, data e próximo agendamento; `ProviderCommand.payload.authorization` transporta grant pelo contrato interno HMAC. A origem confere o scope da rota e grant. Novos comandos internos `reconcile` apenas renovam a concessão operacional curta e adicionam âncoras de conversas anteriormente desconhecidas dentro da mesma operação. NÃO autorizam outro tenant nem resetam quota.

Fechar aba, expirar/revogar sessão do browser, logout do atendente ou trocar organização não revoga a concessão de fundo. Membership/permissões/usuário/organização inativos revogam o grant; o Worker pausa o produtor imediatamente, inclusive quando a revogação é detectada durante execução de comando pendente. Credenciais WhatsApp revogadas, erros SQL, indisponibilidade de serviço ou falta de renovação interrompem futuras solicitações. A origem exige uma renovação de segurança a cada 45s de atividade; ela não substitui o grant persistente. O Worker renova via outbox a cada 15s enquanto ativo e procura novas âncoras no máximo a cada 5min após resposta terminal. Toda execução usa o lease existente por conexão e não depende de Redis para a verdade de mensagens; falha de notificação conserva o replay SQL.

Pausar e desativar impedem novas solicitações, preservando checkpoints e dados importados. Desativar permite reativar o MESMO orçamento seguro, com nova confirmação. Sem reposição automática. Solicitação sem resposta em 60s é inconclusiva; erro de envio ou reinício com dispatch intent torna resultado incerto. Nenhum desses estados repete solicitações, mesmo ao retomar. Reinício sem request pendente, com spool/referência/cursor conhecidos, pode ser retomado automaticamente após revalidação do grant. Download transitório de referência já confirmada usa backoff de 60–300s, até cinco falhas; não repete a requisição ao WhatsApp.

## Orçamentos e proteção operacional

Piloto 20 mensagens admitidas, máximo 500 contatos/500 conversas, janela congelada de 30 dias, até 16 solicitações e até 100 mensagens/solicitação (no piloto, máximo 20). Uma operação por conexão e um Channel WHATSAPP_WEB por organização; uma solicitação em voo por operação. Concorrência total usa o Worker existente, até dois scopes, sem duplicar filas. Seleção de âncoras reutiliza uma consulta compartilhada, scoped e limitada, escolhendo a mensagem mais antiga elegível dentro da janela, sem perder referências recentes quando existem mensagens anteriores ao intervalo. Novas âncoras podem aparecer por ingestão live/metadados conhecidos; conversas metadata-only aguardam uma mensagem válida, sem fabricar referência.

Antes de novo dispatch, intervalo mínimo de 30s e cooldown de 5min por conversa. Resposta sem avanço conclui aquela âncora; reconciliar não a solicita novamente. O Worker nunca inicia outra operação ao finalizar orçamento. Ampliar piloto exige alteração explícita da política da organização em entrega posterior; esta versão não oferece ampliação irrestrita.

Backlog live >100 itens/eventos ou RSS >384MiB pausa o produtor; cooldown de segurança 60s. Cap de produção 512MiB preservado. SQL com falha interrompe renovação, filas aplicam retry/dead-letter existente. Journal mantém prioridade live e staging separado. Arquivos de protocolo: comprimido 1MiB/descomprimido 8MiB, até 16 referências/32MiB acumulados, uma obtenção de referência por vez, 15s. Spool 2MiB; staging histórico 1.500 itens/1,5MiB, reserva live 2.000/2MiB, promoção20 itens/48.000bytes, envelope64KiB. Mídias permanecem metadados.

## Flags e deploy

Compose mantém defaults `PROVIDER_HISTORY_EXECUTION_ENABLED=false`. Publicação CP4.7 usa true no Core/Provider como capacidade, juntamente com `PROVIDER_HISTORY_SCOPED_AUTHORIZATION=true` no Provider. Isso exige grant explícito da conexão e nunca solicita dados apenas pelo deploy. `PROVIDER_HISTORY_ENABLED=false`, SDK automático/full-history false, linked-recovery-only true e restart:no preservados. Flags false sempre bloqueiam execução, inclusive com grant. Sessão vinculada e limites de recuperação existentes são preservados.

Sem migration nova; colunas JSON CP4.6 continuam compatíveis. Rollback: pausar/desativar via novo Core se autorizado, drenar journal válido, flags false e imagens CP4.6. Não restaurar banco ou snapshots Signal sobre sessão viva. Recuperação do Provider é limitada: se orçamento de conexão estiver esgotado, parar e diagnosticar; nunca repetir reinícios/resetar orçamento automaticamente.

## Chat e evidência

Configurações → Provedores exibe WhatsApp, Sincronização de mensagens e Histórico de conversas. Conta conectada é distinguida de último estado conhecido e erro de consulta. Ativação tem confirmação, limites e informação de disponibilidade parcial. Quantidade principal é somente `manifest.messages.length` confirmado no Core; contatos/tentativas/lotes não são somados a mensagens. Diagnóstico expansível conserva contadores e painel anterior; falhas14 legadas permanecem históricas sem causas reconstruídas. Demo/Meta ficam em Outros provedores. Desconectar fica no gerenciamento secundário com confirmação própria.

Inbox/paginação, autoria e scroll usam mecanismos CP4.6 existentes; histórico usa eventos agregados, sem alertas de mensagem nova nem refresh de toda a lista. Testes no homelab são headless, com banco/Redis isolados. Homologação visual em desktop/notebook/tablet/smartphone é manual; não executamos navegador gráfico no servidor.
