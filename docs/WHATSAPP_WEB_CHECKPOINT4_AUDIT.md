# Auditoria CP4 — antes da implementação, 10/10/2026

Core main ea21b7e, Chat main 93420d1, ambos limpos. Imagens produtivas CP3:
Core/Worker/Provider 42a7651 e Chat da38c2f. Sessão real: uma CONNECTED, sem
erro, active=1, pending=dead=0. Consulta somente de estado/contagens, sem auth,
JID, nomes ou conteúdo em evidências/logs. Contact 6, Conversation 6, Message 42;
ProviderConnection 1, comandos 3, inbox 7. Backup e relatórios CP1–CP3 lidos;
snapshot completo protegido em deploy-records/wapphub-provider-web/20261010-checkpoint4.

Baileys instalado e lock: exatamente 7.0.0-rc14. Events.d.ts inclui
messaging-history.set/status, chats.upsert/update, contacts.upsert/update,
lid-mapping.update, messages.upsert/update. Contact inclui id/lid/phoneNumber;
mensagens incluem identidade alternativa e timestamp externo. append representa
histórico/offline; requestId será descartado por proteção contra spoofing.
Advisory oficial GHSA-qvv5-jq5g-4cgg corrigido em rc12; rc14 preservada.

CP3 desabilita shouldSyncHistoryMessage e syncFullHistory; recebe apenas texto
notify e recibos. Não existe store bruto de chats/histórico no Provider e o
histórico anterior pode não estar mais disponível. Nunca apagar/recriar vínculo.
downloadHistory instalado acumula inflate sem limite de saída: habilitar o
download automático irrestrito não atende o limite de memória. CP4 manterá o
download SDK automático desligado e terá leitor explícito limitado, apenas de
notificação self-origin validada, opt-in com autorização operacional prévia.
Deploy mantém histórico desabilitado. Nenhuma importação histórica real extensa
nem fetchMessageHistory será disparado pelo agente.

Contrato canônico CP1 contém mensagem/recibo/mídia/conexão, mas não contato,
conversa, lote, progresso ou indicação histórica. Extensão aditiva versão1 é
necessária: lote normalizado estrito, até20 itens/64KiB, usando o mesmo conteúdo,
direção/origem/capabilities e IDs; sem tipos SDK, URLs, QR, auth ou binários.
Novos consumidores devem ser publicados antes do produtor de novos tipos.

Reutilizar Contact, ContactIdentity, Conversation, Message e ProviderInbox. A
unicidade organization/channel/contact em ContactIdentity impede aliases PN/LID;
substituir somente esse índice único por índice de consulta, preservando PK e
FKs tenant. Mapeamento explícito pode vincular novo alias ao contato existente;
conflito entre contatos já criados falha com código seguro, sem fundir histórico
ou metadados administrativos. Nunca associar por nome ou converter LID em telefone.

Migration versionada acrescentará somente metadados/progresso nos modelos atuais
e armazenamento limitado de recibos pendentes; nenhum segundo modelo de mensagem
ou base de contato. Conteúdo de mídia permanece referência/metadado, download
indisponível. Preservar nome manual, atribuição, tags, notas, status administrativo.

Core hoje pagina e aplica FULL/LIMITED/NONE por sequence de ingestão. Para Web,
histórico deve ordenar timestamp original/id com cursor estável e manter a
fronteira de autorização por sequence, excluindo importação tardia histórica em
contextos restritos. Preview precisa da mesma proteção. lastMessageAt só avança
por timestamp; nenhuma importação torna conversa antiga artificialmente recente.

Journal criptografado/vault/fsync, writer lock e lifecycle CP2 permanecem. Staging
normalizado limitado e durável separa histórico de eventos novos; pull prioritário,
fatias pequenas, limites de bytes/itens/cumulativos, ack após commit, retry limitado
e métricas/progresso. Inbox SQL autoritativa. Lotes prebuscam identidades,
conversas/mensagens; invalidam contatos e histórico por lote/conversa sem eventos
individuais de nova mensagem histórica. Redis continua somente wake-up.

UI providers deve mostrar preparação/geração/autenticação, estado conectado separado
de progresso e contadores reais, sem porcentagem inventada. Navegação livre; troca
de tenant/permission invalida estado. Autoridade continua Core/RBAC/session/CSRF.
Demo e futuro Meta compartilham conteúdo/contratos, sem SDK no Core.

Gates: eventos sintéticos SDK real, restart/falhas/dedup/fora de ordem/PN-LID/mídia,
isolamento/RBAC/visibilidade/metadados/limites, testes completos, OpenAPI/drift,
lint/typecheck/build/audits/CI e carga sintética medida. Sem browser no Homelab.
Backup fresco verificável e restore/migration isolados antes de produção; imagens
anteriores preservadas. Deploy com Core compatível primeiro, Provider privado e
histórico real desligado, Chat depois. Preservar credenciais e desired da sessão;
nenhum logout/disconnect/re-pair/envio. Rollback preferencial desabilita intake de
sync em CP4 e conserva parser/journal compatíveis; CP3 não entende lotes pendentes.

Fontes: código instalado em node_modules/baileys/lib/Types e Utils/history.js;
https://github.com/WhiskeySockets/Baileys/security/advisories/GHSA-qvv5-jq5g-4cgg.
