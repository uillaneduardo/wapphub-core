# WhatsApp Web — captura inicial nativa, limitada e sem novo pareamento

## Diagnóstico

No CP4/CP4.7, `syncFullHistory: false` e `shouldSyncHistoryMessage: () => false`
impediam a captura nativa no primeiro QR. O histórico sob demanda por
`fetchMessageHistory` exige âncoras já conhecidas e não enumera conversas
desconhecidas. A conta atualmente vinculada não pode ser presumida capaz de
reenviar o bootstrap após uma reconexão.

A versão travada é Baileys `7.0.0-rc14`. Em `src/Socket/chats.ts`, o SDK
emite `messages.upsert` antes de aplicar o filtro de histórico e, quando
`shouldSyncHistoryMessage` retorna true, faz download/descompressão do arquivo
pelo próprio SDK sem os limites por operação do WappHub.

## Correção proposta

- Primeira vinculação por QR, sem identidade autenticada persistida:
  `syncFullHistory: true` e identificação Desktop para solicitar o bootstrap.
- `shouldSyncHistoryMessage: () => false` continua intencionalmente: a leitura
  dos arquivos é feita pelo adaptador com `readBoundedHistory`, e não pelo
  leitor ilimitado do SDK.
- Notificações autênticas `messages.upsert` originadas do próprio dispositivo
  são filtradas por tipos conhecidos (`INITIAL_BOOTSTRAP`, `RECENT`,
  `FULL`, `PUSH_NAME`, `NON_BLOCKING_DATA`, `INITIAL_STATUS_V3`).
  Respostas `ON_DEMAND` continuam exclusivas do importador autorizado do CP4.7.
- As referências de download entram na estrutura `historyImports.pending` do
  Vault já criptografado; o processamento é sequencial e alimenta o journal
  `sync.batch`, sem novo banco, fila ou contrato.
- Deduplicação, limites de arquivo/staging/spool, timeout e prioridade live
  permanecem. Na consolidação B2, 100 registros de wire/até300SyncItems por
  página têm cursor durável e staging atômico; 500/500/1000 continuam limites
  ON_DEMAND, sem teto permanente de contatos/conversas/mensagens do bootstrap.
- A captura inicial permanece pendente apenas enquanto sua sessão de bootstrap
  está ativa; reconectar uma conta já vinculada NÃO ativa `syncFullHistory`
  nem novo QR.
- O leitor aceita no máximo 4 MiB comprimidos e 16 MiB descomprimidos por
  arquivo, mantendo um teto cumulativo de 32 MiB e orçamento máximo de 16
  notificações. Referências armazenadas têm limites individuais e cumulativos.
  Dados acima desses limites são recusados com diagnóstico de sincronização
  parcial, não com alocação ilimitada.
- Uma resposta ON_DEMAND já recebida, com referência criptografada retida e erro de tamanho, pode ser redecodificada dentro dos novos limites sem reenviar a solicitação ao WhatsApp. Sem referência persistida, a recuperação não pode ser presumida.
- `PROVIDER_INITIAL_HISTORY_ENABLED` pode ser desabilitada operacionalmente
  sem desligar a sincronização contínua.

## Aceite e limitações

Esta implementação não prova disponibilidade remota de histórico na conta
já conectada; não reconstrói notificações descartadas em pareamentos anteriores.
Dados entregues pelo WhatsApp podem ser parciais e arquivos acima dos limites
continuarão sendo recusados. Uma recuperação adicional em conta já vinculada
depende de evidência do protocolo, uma âncora conhecida e autorização separada.

Antes de publicar: testes do Provider/Core, lint, typecheck, build, CI e
backups restaurados em ambiente isolado. Deploy controlado deve preservar
credenciais e volumes; nunca executar logout ou novo pareamento automático.
A homologação visual/funcional e eventual pareamento com uma conta de teste
ficam com o usuário após deploy. Não registrar conteúdo de mensagens, chaves
ou referências criptográficas nos logs.


## Consolidação B1–B4 — validação técnica, sem publicação

RECENT100 não congela a captura: append recente volta ao live; arquivo entregue
continua por páginas/cursor/cache AES-GCM, sem download repetido por página.
Janela persistida, intervalo30s, backoff30–300s e cincofalhas. Orçamento de32MiB/16
referências delimita o ciclo inicial e não é reposto silenciosamente. Arquivos
acima dos limites permanecem parciais; páginas não transformam bytes recusados
em histórico recuperado. Correlação bootstrap scoped não consome grantON_DEMAND.
620conversas/1240mensagens sintéticas processadas através de restart; isso não
prova recuperação remota. Evidências/CI no progresso canônico e planoB5.
