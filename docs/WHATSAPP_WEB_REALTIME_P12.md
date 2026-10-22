# P1.2 — Consulta pontual e preservação do histórico autorizado

Entrega em revisão, sem merge/deploy. Baseline publicado Core763981a/Chatbaaee36.
Complementa o relatório P1.1 e o Chat PR30. Não modifica Provider, filas, sessão
WhatsApp, persistência, sincronização ou histórico.

Defeito reproduzido: reconsultar N páginas após uma chegada desloca a janela;
uma linha já carregada pode ficar fora dessas páginas, ser removida do DOM e
perder seu player. Uma mensagem antiga visível pode continuar PENDING apesar
de SQL/REST DELIVERED quando a atualização consulta apenas a primeira janela.
Testes Chat reproduzem o caso; não é evidência de F5 no navegador humano.

Contrato aditivo: GET `/api/v1/conversations/:id/messages/:messageId`, delegado
à função Chat.getMessage em src/application/chat.ts. Usa contexto messages.read,
Conversation autorizada, tenant, piso de sequência, corte de importação histórica
e masking de contatos idênticos à listagem. Ausente/invisível retorna404
MESSAGE_NOT_FOUND; leitura sem permissão403. Auditoria supervisionada mantida.

ConversationDTO.readScope é SHA256 opaco dos limites efetivos de leitura de
mensagens/notas e masking, identidade e canal. Só invalida cache; nunca é
credencial nem substitui autorização por requisição. Metadados/status novos não
mudam o hash. Transferências restritivas e alterações reais de autoridade mudam
ou invalidam o contexto. O Chat mantém páginas previamente autorizadas quando o
hash é igual, faz leitura pontual por evento e recuperação limitada no foco.
Core anterior continua compatível via fallback explícito404NOT_FOUND.

Arquivos: application/chat.ts, http/chat-routes.ts, OpenAPI oficial;
tests/chat.test.ts, tests/web-provider.test.ts e foundation.test.ts.
Testes cobrem FULL/LIMITED/NONE, supervisor, antiga atribuição, outro tenant,
permissão negada, hash estável em novas mensagens e progressão SENT/DELIVERED/READ
com o mesmo clientMessageId através de SQL/realtime/replay/REST.

Custo: uma consulta pontual por evento substitui reconsulta das páginas abertas;
uma auditoria por leitura supervisionada, igual à API existente. Hash SHA256
pequeno por DTO, sem cache sensível persistente. Retenção Chat limitada ao
histórico explicitamente carregado; pool de bytes de mídia tem limites próprios.
Não medido desempenho do código novo em produção (sem deploy).

Rollback: retornar imagens baseline anteriores documentadas no P1.1/P1.2.
Sem migrations ou reversão de dados. Reverter Chat antes do Core evita depender
do contrato novo; fallback suporta Core antigo. Retorna o defeito de janela.
Homologação real: mensagens antigas visíveis recebem recibos, reconnect/foco,
transferência FULL/LIMITED/NONE, perda de acesso, rascunho/scroll/player preservados;
verificar reload real versus remount pelos diagnósticos opt-in do Chat.

Validação final local: Core156/156, lint/typecheck/build e OpenAPI idêntico
aprovados. Provider151/151/CI da correção de voz aprovados; este incremento
não altera Provider. Evidências core-point-*.log na pasta20261013-p12-consistency.
