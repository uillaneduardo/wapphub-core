# B5 — plano de publicação, ainda não executado

B1–B4 produzem branches/PRs e validação técnica. **O usuário proibiu deploy, alteração da sessão e mensagens reais nesta execução.** B5 requer autorização específica posterior; B6 é homologação humana. Fonte canônica: [PROGRESS](WHATSAPP_WEB_CONSOLIDATION_PROGRESS.md); escopo final: [IMPLEMENTATION](WHATSAPP_WEB_CONSOLIDATION_IMPLEMENTATION.md).

## Gates antes da publicação autorizada

1. Revisar/integração documental PR25 → P0 PR26 → implementação Core/Provider e Chat. Validar CI do SHA integrado, original/remoto/publicado e inexistência de alterações operacionais locais. Não presumir que CI de branches equivale ao merge final.
2. Novo baseline sanitizado de saúde, recursos, flags, sessão/socket, journal/backlog, grant histórico, requests e comandos. Conta existente tem attempts=5: CP47 antigo não é rollback seguro após restart. Construir imagem **compatível com B1/recoveryFailures**, testar com Vault sintético equivalente; preservar imagens CP47 apenas como referência.
3. Backup consistente MariaDB, arquivos Compose/configuração e Vault/cache criptografados, com acesso restrito/manifest de hashes. Testar restauração **isolada sem rede externa** e aplicar 12 migrations ao backup isolado. Backup não significa permissão de restaurar Signal sobre sessão ativa; jamais substituir credenciais por snapshot antigo. Não fazer logout/QR/reset para conseguir backup.
4. Construir imagens imutáveis Core/Provider/Chat com revision SHA exata; testar imports/Compose e cinco formatos sintéticos com flags fechadas. FFmpeg existe apenas na imagem Provider; 512 MiB/1CPU/128pids, RSS gate384MiB, cache quotas e /tmp96MiB precisam caber nos recursos atuais. Conferir espaço antes de criar backup/imagens; não apagar volumes/imagens arbitrariamente.
5. **Tratar grant histórico existente**: baseline tem grant ENABLED e operação PAUSED/HISTORY_BYTE_LIMIT com uma requisição preexistente. Não convertê-lo silenciosamente em nova autorização nem iniciar pedido remoto durante deploy. Manter Provider/Core execution gates fechados na publicação enquanto esse grant é inspecionado/revogado ou pausado sob autorização aplicável. Bootstrap só processa dados já fornecidos, sem fetch remoto. Reabilitação de recuperação adicional exige confirmação vigente do administrador no escopo correto.
6. Aplicar migration aditiva ao Core autorizado, publicar apenas serviços necessários em sequência compatível; nunca reiniciar DB/Redis por conveniência. Provider usa volumes/chaves atuais, linkedRecoveryOnly e sem pairing. Limitar tentativas pelo B1; se não recuperar conexão, parar novas tentativas, preservar estado e diagnosticar. Nenhum patch manual de auth/Signal/attempts.
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

Nenhum backup/restauração produtiva, merge, deploy, teste gráfico ou envio real descrito acima foi executado em B1–B4.
