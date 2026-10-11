# Preparação da sincronização histórica — 11/10/2026

CP4 de sincronização contínua encerrado e homologado pelo usuário; [seis testes e latência observada](WHATSAPP_WEB_CP4_ACCEPTANCE.md). Este documento é preparação e auditoria, sem importação real, publicação de runtime ou alteração da sessão.

## Histórico disponível na auditoria

A leitura offline do vault criptografado, montado somente leitura e sem rede, encontrou uma sessão CONNECTED/desired com identidade existente;0 lotes históricos recuperáveis,0 itens históricos pendentes,0 dead-letter histórico. Contadores duráveis de admissão histórica:0 contatos/0 conversas/0 mensagens. historyImports ausente e0 marcadores processedHistoryMessages; accountSyncCounter0. Não há cache de payload/notificação histórica para reprocessar.

No Core, consulta scoped confirmou0 mensagens historical=true e31 lotes cumulativos de sincronização. Esses31 lotes são processamento contínuo, não comprovação de lotes históricos: ProviderInbox guarda tipo/hash/correlação, sem a flag historical ou payload. Existe checkpoint operacional cumulativo, mas nenhum checkpoint de importação disponível na origem.

SDK automático desativado: shouldSyncHistoryMessage retornafalse e syncFullHistory=false. O listener messaging-history.set também retorna sem processar/registrar quando história está desativada. Portanto não existe evidência suficiente para afirmar se um evento antigo chegou ao SDK, e ausência de registros não comprova ausência de notificações em toda a vida da sessão. Notificações descartadas sem payload não podem ser reconstruídas com segurança.

A sessão segue conectada; nenhuma chamada para obter dados históricos, pull de filas pelo auditor, novo socket, logout ou pareamento foi executada. As14 falhas legadas permanecem desconhecidas, sem ligação inventada com histórico ausente. Registros read-only em deploy-records/wapphub-provider-web/20261011-cp4-acceptance-history-preparation/.

## APIs e limitações RC14

A versão instalada e travada é baileys7.0.0-rc14. Sua função fetchMessageHistory(count,oldestMsgKey,oldestMsgTimestamp) exige creds.me.id e envia uma operação de controle HISTORY_SYNC_ON_DEMAND ao aparelho associado. Retorna identificador da solicitação, não um lote pronto nem garantia de quantidade/completude. Requer conversa, ID/direção da mensagem âncora e timestamp em milissegundos; não descobre todas as conversas desconhecidas.

Essa função não está exposta pelo transport/HTTP do Provider nem pelo Core. Não foi chamada. A conta autenticada satisfaz a pré-condição local de identidade, mas disponibilidade adicional no celular/servidor, volume e prazo não foram comprovados. A solicitação real precisa de autorização específica e integração operacional controlada, sem envio de texto. Reconectar ou alternar full-history não garante que o servidor reenvie o bootstrap inicial. Novo pareamento não é a primeira alternativa e nunca será automático.

processHistoryMessage conhece INITIAL_BOOTSTRAP/RECENT/FULL/ON_DEMAND e PUSH_NAME, produz contatos/conversas/mensagens/mapeamentos PN-LID. Contatos/conversas de eventos contacts/chats upsert/update já são independentes de mensagens; isso não garante uma listagem completa de todos os contatos/chats antigos. PUSH_NAME pode oferecer apenas nomes. Grupos/broadcast e tipos de mensagem não suportados permanecem fora da capacidade atual.

A auditoria utilizou o código instalado; referências primárias da mesma versão:
- [Solicitação ON_DEMAND](https://github.com/WhiskeySockets/Baileys/blob/v7.0.0-rc14/src/Socket/messages-recv.ts).
- [Decodificação e tipos de histórico](https://github.com/WhiskeySockets/Baileys/blob/v7.0.0-rc14/src/Utils/history.ts).
- [Gating e estado da sincronização](https://github.com/WhiskeySockets/Baileys/blob/v7.0.0-rc14/src/Socket/chats.ts).

## Limites propostos e limites efetivos

| Dimensão | Limite |
|---|---|
| Contatos admitidos | até500 |
| Conversas admitidas | até500 |
| Mensagens admitidas | até1000 |
| Identidades distintas | até500 grupos de identidade PN/LID verificados |
| Janela inicial | últimos30 dias, timestamps originais |
| Arquivo histórico comprimido | até1MiB |
| Histórico descomprimido | até8MiB por notificação/arquivo |
| Downloads de histórico |1 simultâneo, timeout15s, até16 notificações e32MiB descomprimidos aceitos cumulativos |
| Staging histórico | até1500 itens/1,5MiB, com reserva para tráfego novo até2000 itens/2MiB |
| Lote normalizado ao Core | até20 itens; promoção48.000 bytes e envelope64KiB |
| Tentativas de entrega | até5 com lease/backoff/dead-letter |

8MiB limita a descompressão do arquivo de protocolo, não altera o contrato canônico para envelopes8MiB. Download de arquivo de histórico de protocolo é distinto de download de imagens/áudios/documentos; qualquer requisição desse arquivo real também dependerá da autorização. Mídia de mensagens continua somente metadados/referências, sem binários/chaves/URLs brutas no MariaDB.

Limites cumulativos sobrevivem ao reinício. Janela limita admissão e não apaga dados existentes. A margem de data do Core usa relógio atual; uma operação futura deve congelar e persistir seu intervalo e conciliar a retenção quando retomada.

## Preparação comprovada e gaps anteriores à execução

A estrutura existente garante persistência idempotente no Core, timestamps/autoria preservados, tenant/lease/RBAC, metadados administrativos protegidos e realtime agregado. O journal prioriza trabalho contínuo e retoma itens já admitidos duravelmente. Lotes sem contatos ou sem mensagens são suportados.

Um teste novo prepara500 contatos+500 conversas+1000 mensagens em micro-lotes com drenagem entre etapas, injeta mensagem nova e restaura vault durante pendência. Não prova que um único evento espontâneo com2000 itens possa ser integralmente admitido: o staging histórico limita1500 itens/1,5MiB e atualmente rejeita excesso sem aguardar espaço. A leitura de histórico aplica processHistoryMessage antes de truncar categorias;8MiB descomprimidos não garantem por si só um limite de objetos JS. Replays de itens históricos podem consumir novamente os contadores de admissão antes da deduplicação no Core. O digest do arquivo marcado como visto comprova staging executado, não necessariamente admissão completa de todos os itens se houve limite.

Não declarar importação pronta para execução. Antes de pedir execução real, a integração deverá:
1. Expor solicitação ON_DEMAND scoped pelo Core e adapter, com identidade/âncora validada e limites fechados; manter SDK automático/full-history e envio de texto desativados.
2. Persistir operação, escopo, intervalo, cursor, contadores de itens únicos e manifest de IDs internos novos em estruturas de checkpoint existentes. Replays não podem gastar orçamento novamente ou saltar itens não admitidos.
3. Limitar seleção de contatos/chats/mensagens antes de materializar a expansão do SDK, filtrar/ordenar a janela antes do corte e pausar produtor quando o staging estiver cheio. Retomar sem importar fora de escopo ou sobrescrever conteúdo.
4. Disponibilizar pausa/cancelamento apenas do produtor histórico e preservar a sincronização contínua; hoje não existe comando runtime de importação/pausa. Não usar restart/desconexão para simular esse comando.
5. Testar a cadeia completa, os limites, interrupção/replay sob capacidade, falhas e controles de autorização antes de ativar operação. Nenhum novo modelo de mensagens/contatos ou mudança do contrato canônico é necessária para esta preparação.

Nenhum desses gaps afeta o aceite contínuo já realizado. Nesta etapa não foram implementados comandos de operação nem habilitado o flag de histórico; há0 lotes locais para importar.

## Recursos e estimativa de impacto

Snapshot do homelab: memória disponível4.108.963.840 bytes (3,83GiB), disco livre14.637.842.432 bytes (13,63GiB). Provider88,16MiB/512MiB, Worker82,96MiB, MariaDB41,48MiB. CPU em repouso Provider0%, Worker0,21%; amostras, não limites de pico.

Máximo de conteúdo original1000×8000 caracteres equivale a até32MB UTF-8 teóricos, antes de overhead/índices/realtime/backup e eventuais transmittedBody. Reservar pelo menos256MiB de disco para a operação e backups frescos, reavaliando volume serializado real. Não são reservados binários de mídia. Memória de descompressão+protobuf é transitória; manter margem de pelo menos1GiB no host e verificar pico do Provider abaixo de seu cap512MiB antes do piloto.

A promoção de até2 lotes por pull e o intervalo2s do Worker implicam cerca de50 ciclos para2000 itens com lotes cheios: aproximadamente100s só de espera programada, além de SQL/fsync/rede, ciclos de fairness e retentativas. Estimativa do pipeline saudável: ordem de minutos; não prometer prazo de aquisição do WhatsApp. Lotes menores por bytes exigirão mais ciclos. Métricas sintéticas são registradas separadamente e não são SLA de produção.

## Plano após autorização específica

Primeiro fechar os gaps em código não ativado e passar os gates. Depois apresentar imagem/versão, limites, estimativa e forma de pausa para aprovação específica da operação real. Revalidar connected/readiness, backlog/dead-letter, espaço/RAM, tenant/connection, backups restauráveis e preservação das falhas legadas. Não modificar o pareamento nem reiniciar serviços nesta auditoria.

Com a operação autorizada, consultar inicialmente uma conversa conhecida com âncora e lote pequeno (por exemplo20 mensagens), sem novo pareamento; verificar resposta validada/self-origin e janela. Se não houver dados, registrar ausência/timeout e parar, sem aumentar escopo ou solicitar QR. Havendo dados, admitir primeiro contatos/conversas de forma independente, depois mensagens, com os máximos cumulativos500/500/1000 e produtor pausável. Novas mensagens têm prioridade e histórico usa invalidações agregadas, sem alerta por item.

Confirmar no Core cada commit antes do ack. Conservar autoria WappHub previamente persistida, não converter DEVICE em atendente, não inferir autoria do corpo, não fundir contatos por nome. Conflitos devem ser rejeitados e diagnosticados sem reescrever registros existentes. Monitorar CPU/RAM/tempo/backlog/rejeições, contadores recebidos/admitidos/persistidos/duplicados, histórico parcial e falhas recuperadas. Se capacidade não permitir preservar o tráfego novo, suspender somente o produtor histórico.

## Rollback

Nesta preparação não há runtime/migration/dados reais alterados; rollback documental é reversão dos commits desta preparação, preservando evidências e aceite informado pelo usuário. Imagens de produção e overlay linked-only/history-off/restart-no permanecem.

Na operação futura, rollback preferencial é pausar/cancelar requisições históricas e escoar lotes duráveis válidos com worker compatível, mantendo live e autenticação. Preservar mensagens já importadas é mais seguro que desfazer commits. Exclusão corretiva não está autorizada; exigiria manifest de IDs criados pela operação e autorização específica, preservando tráfego contínuo/atribuições/tags/notas/autoria. Não executar DELETE por historical=true, não restaurar banco inteiro ou snapshot Signal sobre sessão viva e não trocar para parser antigo incompatível com sync.batch.

Novo pareamento pode invalidar o dispositivo existente, interromper intake e expor novamente QR/credenciais, sem garantia de mais histórico. Exige uma decisão separada após falha documentada das alternativas não destrutivas; não será solicitado automaticamente.
