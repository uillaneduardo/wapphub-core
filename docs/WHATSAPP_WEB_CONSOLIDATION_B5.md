# B5 — integração e publicação controlada

**Estado atual: `B5_BLOQUEADO` — correções técnicas concluídas localmente, CI dos novos commits pendente.** A primeira tentativa B5 ficou bloqueada por FAILED/RECONNECT_LIMIT e MEDIA_BUSY. Esta rodada corrige também o P0 de gerenciamento do vínculo; não autoriza deploy, restart nem recuperação real. Produção continua CP4.7, FAILED/attempts=5, sem socket. Histórico PAUSED/HISTORY_BYTE_LIMIT, requests=1 e mensagens históricas=0. O mecanismo novo preserva a sessão parada e só tenta rede após confirmação administrativa explícita. O estado técnico será atualizado após CI.

B1–B4 produziram branches/PRs e validação técnica; o usuário autorizou B5 nesta execução. B6 é homologação humana. Fonte canônica: [PROGRESS](WHATSAPP_WEB_CONSOLIDATION_PROGRESS.md); escopo final: [IMPLEMENTATION](WHATSAPP_WEB_CONSOLIDATION_IMPLEMENTATION.md).

## Gates antes da publicação autorizada

1. Revisar/integração documental PR25 → P0 PR26 → implementação Core/Provider e Chat. Validar CI do SHA integrado, original/remoto/publicado e inexistência de alterações operacionais locais. Não presumir que CI de branches equivale ao merge final. O usuário autorizou esta sequência, mas a publicação do Provider permanece bloqueada pelo gate de sessão `FAILED/attempts=5` até existir recuperação comprovadamente segura sem reset/QR.
2. Novo baseline sanitizado de saúde, recursos, flags, sessão/socket, journal/backlog, grant histórico, requests e comandos. Conta existente tem attempts=5: CP47 antigo não é rollback seguro após restart. Construir imagem **compatível com B1/recoveryFailures**, testar com Vault sintético equivalente; preservar imagens CP47 apenas como referência. O código corrigido cobre Vault legado FAILED/attempts=5 e não o recupera automaticamente no bootstrap. A publicação deve deixá-lo parado até confirmação explícita de recuperação, sem reset de contador, QR ou alteração manual do Vault.
3. Backup consistente MariaDB, arquivos Compose/configuração e Vault/cache criptografados, com acesso restrito/manifest de hashes. Testar restauração **isolada sem rede externa** e aplicar 12 migrations ao backup isolado. Backup não significa permissão de restaurar Signal sobre sessão ativa; jamais substituir credenciais por snapshot antigo. Não fazer logout/QR/reset para conseguir backup.
4. Construir imagens imutáveis Core/Provider/Chat com revision SHA exata; testar imports/Compose e cinco formatos sintéticos com flags fechadas. FFmpeg existe apenas na imagem Provider; 512 MiB/1CPU/128pids, RSS gate384MiB, cache quotas e /tmp96MiB precisam caber nos recursos atuais. Conferir espaço antes de criar backup/imagens; não apagar volumes/imagens arbitrariamente.
5. **Tratar grant histórico existente**: baseline tem grant ENABLED e operação PAUSED/HISTORY_BYTE_LIMIT com uma requisição preexistente. Não convertê-lo silenciosamente em nova autorização nem iniciar pedido remoto durante deploy. Manter Provider/Core execution gates fechados na publicação enquanto esse grant é inspecionado/revogado ou pausado sob autorização aplicável. Bootstrap só processa dados já fornecidos, sem fetch remoto. Reabilitação de recuperação adicional exige confirmação vigente do administrador no escopo correto.
6. Aplicar migration aditiva ao Core autorizado, publicar Core/Worker com semântica disconnect correta antes de Provider e Chat (evita tradução antiga em logout), apenas serviços necessários em sequência compatível; nunca reiniciar DB/Redis por conveniência. Provider usa volumes/chaves atuais, linkedRecoveryOnly e sem pairing. Usar recuperação controlada de uma tentativa por confirmação: RUNNING durável antes da rede, limite total120s e SUCCEEDED somente após open autenticado+30s estáveis. Sem autorização específica, não acionar recover nesta publicação; se falhar, preservar estado e diagnosticar, sem repetir automaticamente. Nenhum patch manual de auth/Signal/attempts.
7. Outbound/media: flags técnicas podem disponibilizar a capacidade no deploy autorizado, mantendo booleans de cada conexão **false** até confirmação administrativa no Chat. Habilitar capacidade não envia. Atualizar Core/Worker/Provider em conjunto; Chat antigo tolera campos aditivos, Demo preservado. Nenhuma consulta onWhatsApp real, envio, upload real ou recuperação histórica como smoke automático.
8. Smokes read-only: saúde, READY autenticado, socket/session recuperados, schema12, journal pull/ack normal, live existente, recursos/cache, realtime e autorização por tenant. Conferir requests/remoto: nenhuma nova requisição sem autorização. Observar pressão e backlog com orçamento de tempo; sem polling agressivo ou reinícios repetidos.

## Rollback

Preferir desativar flags de saída/mídia e pausar recuperação adicional via mecanismo autorizado, preservando live e dados. Voltar Core/Chat para imagens compatíveis com schema aditivo e deixar migration instalada; não dropar Media/colunas/mensagens. Provider rollback deve entender Vault recoveryFailures/native cursors/send receipts, conservar ID/outcome e nunca retransmitir UNKNOWN. Imagem só B1 pode ignorar envelopes novos; confirmar compatibilidade antes de usá-la. Se necessário construir rollback seletivo de B1 com guards de leitura dos novos registros; não assumir segurança de CP47.

Preservar Vault/cache/volumes atuais. Nunca restaurar snapshot antigo de credenciais Signal sobre sessão ativa. SQL restore é última medida destrutiva e exige autorização separada; erros reversíveis não justificam perda de dados. Registrar imagens, SHAs, comandos e decisão, sem conteúdo privado.

## B6 — roteiro humano após publicação autorizada

- Desktop/notebook/tablet/smartphone: Inbox e Configurações, teclado, textos longos, loading/erro, cards e scroll. Confirmar conectado/estado verificado, mensagens novas e saída do aparelho sem refresh.
- Administrador habilita saída/mídia somente na conexão escolhida; perfis/organizações sem permissão continuam bloqueados. Abrir contato conhecido e número novo válido/inválido/inexistente; abrir não envia. Troca de organização limpa dados/solicitações.
- **Somente com autorização explícita de envio real**, operador envia texto/imagem/áudio/voz/vídeo a destinatário controlado; conferir autoria/status/echo/dedup, recibos e UNKNOWN sem retransmissão. Avaliar gravação/codec no próprio navegador.
- Mídia recebida abre por demanda; testar acesso FULL/LIMITED/NONE, expiração e Range/players. Não baixar tudo automaticamente.
- Conferir bootstrap/metadados que o protocolo disponibiliza; não prometer todo histórico. Administrador confirma eventual piloto adicional limitado20, acompanha dados efetivamente importados, pausa/desativa e verifica persistência após refresh/fechar aba.
- Preservar atribuições/tags/notas/arquivamento/nome manual, Demo, posição de leitura e ausência de falso não-lido de histórico. Registrar feedback e só então marcar HOMOLOGADO.

Em B5: PR25 e PR26 foram integrados; PR27 e Chat19 seguem abertos porque a suíte local mais recente ainda falha no novo upload HTTP e não há garantia de recuperação do Provider no estado real `FAILED/attempts=5`. Nenhum backup produtivo/restauração, migration de produção, merge de PR27/19, deploy, envio, upload ou solicitação histórica real ocorreu. Migrations foram verificadas apenas em banco sintético. O estado é `B5_BLOQUEADO`, sem homologação B6.


## Resultado desta execução B5 (2026-10-12)

- PR25 e PR26 integrados ao main; merges `d55aa668d7840049fae4e63586b7dcfd3cf32ccc` e `dd8719324387e097ef45769ad94df9b04bd39e5e`. PR27 continua aberto em `137c036479cb942a6cfbe2b5a0601b5f1403c283` (CI desse SHA: validate/provider-web success); Chat PR19 não foi integrado.
- O teste local novo confirma rota Core→cliente HMAC→Provider sintético, mas atualmente falha com `MEDIA_BUSY` repetido; a regressão de ativação histórica passa quando o caso HTTP executa ao final. Não enviar o teste local ainda não validado.
- Sessão produtiva: Core/Provider `FAILED/RECONNECT_LIMIT`, attempts 5, sem transporte. O caso B1 validado não cobre esse estado, portanto Provider não foi reiniciado.
- Nenhuma operação de produção foi alterada. Histórico: uma solicitação anterior, zero mensagens importadas; autorização/operação pausadas. Nenhuma nova solicitação, envio ou upload real.
- Migration aplicada apenas no MariaDB isolado de teste. Backup de produção, restore isolado de backup real, imagens e deploy não realizados.
- Estado final `B5_BLOQUEADO`; B6 não está pronto para homologação porque a publicação não ocorreu.


## 2026-10-12T06:33:35.957499+00:00 — rodada de correção, sem publicação

Os registros anteriores descrevem a primeira tentativa B5 e permanecem como histórico. As correções atuais reutilizam PR27 e Chat19, ainda sem merge. Local: Core133/133, Provider117/117 e Chat300/300; upload HTTP isolado1/1, lint/typecheck/build verdes. CI desses novos commits ainda pendente. Prisma12/migration `20261011210000_consolidation_outbound`, drift sem diferenças novas e OpenAPI verificados em infraestrutura sintética.

Três gates P0: recuperação explícita de FAILED legítimo com auth existente; parada local distinta de logout remoto confirmado/incerto; upload com memória/concorrência separados e cleanup após falha. O erro numérico da desconexão produtiva não foi registrado pelo CP4.7 e não pode ser reconstruído; não afirmar revogação. O Vault passou autenticação GCM/estrutura, mas isso não prova aceitação remota.

**Retomada B5:** conferir heads/CI e integrar PR27/19 somente após validação; renovar baseline, backup consistente e restauração isolada sem WhatsApp; validar migration12 no backup; preparar imagens/rollback compatíveis com recovery/termination/controlVersion/invalidated e recibos UNKNOWN. O CP4.7 antigo não é rollback automático seguro. Preservar auth/Signal; não restaurar snapshots antigos nem fazer downgrade destrutivo. Manter histórico pausado e evitar re-download remoto. Flags outbound/media por conexão continuam false.

A conexão atual não retornará automaticamente após publicar: administrador precisará confirmar a tentativa controlada no Chat, ou autorizar explicitamente execução equivalente em futura rodada. Sem autenticação estável comprovada, o gate operacional B5 continua sem conclusão. B6 permanece humana, após publicação autorizada. Nenhum backup/restore/migration produtivo, deploy, recovery, logout, envio, upload ou fetch real nesta rodada; docs/STATUS.md preservado.
