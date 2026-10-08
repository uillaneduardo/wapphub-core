# Demo Provider (branch M1)

## Estado

Publicado em produção na revisão `72d05aa`, imagem `wapphub-core:demo-72d05aa`;
seis migrations verificadas no ledger, inclusive as duas Demo. Os dois commits
81a8103/72d05aa continuam locais, fora da main remota fa292c4. A validação inicial
foi feita no Compose isolado wapphub-m1-test, depois houve publicação controlada.
A auditoria de 2026-10-08 reexecutou 56 testes e checks nesse ambiente isolado,
sem alterar produção. Ver `GIT_PRODUCTION_INVENTORY_20261008.md` e
`M1_ARCHITECTURE_ACCEPTANCE_20261008.md` para estado de aceite e achados.
Backup pré-Demo gzip íntegro foi encontrado; criptografia/restore recomendados
no procedimento abaixo não têm evidência de execução e permanecem riscos.

O Demo Provider exercita o domínio comum de canais. Ele não chama serviços externos e não implementa Meta, mídia, billing ou convites.

## Arquitetura

`MessagingProvider` define `sendText` e normalização de entrada. `DemoProvider` é o adaptador determinístico e sem rede externa. `MessageIngestionService` persiste a mensagem recebida na tabela `Message` existente; depois o serviço de Chat atualiza a conversa, auditoria e evento `message.created`. Não há segundo armazenamento de mensagens.

Fluxo de entrada: simulador autenticado → endpoint DEMO → adaptador → identidade de contato resolvida no tenant → serviço de ingestão → `Message`/`Conversation` → evento realtime persistido e publicado.

Fluxo de saída: atendimento → `POST /conversations/{id}/messages` → serviço de Chat → `MessagingProvider.sendText` → mesma tabela `Message` como OUTBOUND. O adaptador confirma entrega simulada localmente; não há recibos DELIVERED/READ remotos.

## Modelo

- `Channel` guarda o estado por Organization/provider, com unicidade tenant + provider.
- `ContactIdentity` liga o identificador externo estável do Demo a um Contact e Channel dentro da Organization.
- `Conversation.channelId` e `providerConversationId` identificam o canal e a conversa externa; chaves externas não dependem de nome ou telefone.
- `Message.direction` aceita `INTERNAL`, `INBOUND` e `OUTBOUND`; `senderUserId` identifica atendente e `senderContactId` identifica contato. Entrada nunca usa Owner como remetente.
- `providerMessageId` tem unicidade tenant/channel e é usado para idempotência do provedor. Mensagens M1 antigas conservam direção INTERNAL e clientMessageId.

Na primeira ativação, dois contatos, duas conversas e duas mensagens recebidas são provisionados transacionalmente com identificadores estáveis. Reativar não duplica recursos. Desativar preserva o histórico e bloqueia novas entradas e respostas.

## API e autorização

| Método | Endpoint | Permission | Uso |
|---|---|---|---|
| GET | `/api/v1/providers` | `providers.manage` | Catálogo e estado da Organization atual |
| PUT | `/api/v1/providers/demo` | `providers.manage` + CSRF | Habilitar/desabilitar e provisionar idempotentemente |
| GET | `/api/v1/providers/demo/contacts` | `providers.simulate` | Contatos/conversas disponíveis no simulador |
| POST | `/api/v1/providers/demo/messages` | `providers.simulate` + CSRF | Ingerir texto como contato autenticado |

O servidor resolve Organization da sessão e o contato pelo vínculo tenant/channel. O browser não envia senderUserId nem organizationId. `providers.manage` e `providers.simulate` são concedidas ao OWNER pelo bootstrap RBAC; nomes de role não são usados nas verificações HTTP.

A primeira ativação registra `DEMO_FIXTURES_PROVISIONED` na auditoria, além de `DEMO_PROVIDER_ENABLED`; reativações sem reparo dos fixtures não repetem o registro de provisionamento. Falhas nas operações de ativação, ingestão e envio são registradas no log estruturado com request ID, operação e código de erro, sem conteúdo da mensagem. A API rejeita alteração de status DELIVERED/READ para mensagens externas com `EXTERNAL_RECEIPT_UNSUPPORTED`.

As mensagens utilizam os endpoints M1 existentes de histórico/envio e eventos realtime já documentados. O simulador também precisa de `messages.read` para consultar o histórico pela API normal. Conteúdo não vai no envelope realtime. Status de entrega/leitura externos não são apresentados.

## Publicação e recuperação

Ordem de publicação: backup verificado do banco; aplicar as migrations aditivas e publicar o Core; validar readiness, OpenAPI e sessão; só então publicar o Chat. O Chat desta versão depende dos endpoints `/providers*` e não funciona com o Core anterior. O frontend anterior continua usando as rotas M1 existentes.

O Core anterior conhece apenas `direction: INTERNAL` no schema de resposta. Depois de gravar mensagens Demo `INBOUND`/`OUTBOUND`, voltar somente a imagem/binário do Core pode fazer a leitura de histórico falhar na validação de resposta. Desativar o provedor com o Core novo bloqueia novas mensagens, mas preserva o histórico; não torna seguro voltar ao Core anterior. Após persistir mensagens externas, a recuperação é manter/restaurar um Core compatível ou restaurar, em procedimento aprovado e com indisponibilidade planejada, um backup consistente do banco junto com a versão correspondente do Core. As migrations não têm rollback automático; não remover colunas/tabelas enquanto houver mensagens Demo.

Antes da publicação, produzir backup consistente e criptografado do banco, verificar sua integridade e ensaiar a restauração em ambiente isolado. Registrar commit e digest da imagem anterior do Core e do Chat. Antes de ativar o Demo, rollback de binário do Core após a migration continua sujeito à compatibilidade do cliente Prisma; não presumir reversibilidade só por a migration ser aditiva. Depois de ativar e persistir dados Demo, não fazer rollback isolado do Core. Reverter primeiro o frontend é seguro para os dados; manter o Core compatível e desativar o Demo. Usar restauração do backup apenas como recuperação de desastre, sabendo que ela descarta gravações posteriores ao ponto restaurado.

## Homologação e limites

Executar somente com `scripts/m1-test.sh` e configuração `NODE_ENV=test`/database `_test`. A suíte verifica ativação, permissionamento, tenant, autoria, idempotência, preservação/bloqueio ao desativar e WebSocket nos dois sentidos. A UI de homologação é `/app/providers/demo/simulator`.

Para integrar futuramente outro canal, implementar o port `MessagingProvider`, mapear identidades externas tenant-scoped e usar a ingestão normalizada. Este documento não declara nenhum adaptador Meta implementado. Meta aparece apenas como `IN_DEVELOPMENT` no catálogo da interface.
