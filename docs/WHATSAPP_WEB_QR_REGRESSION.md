# Regressão de primeiro pareamento por QR — 13/10/2026

Estado desta revisão: correção em validação; nenhuma homologação real presumida.
Fonte canônica de avanço: [progresso](WHATSAPP_WEB_CONSOLIDATION_PROGRESS.md).

## Evidência histórica e alteração responsável

O relatório CP4 de 10/10 registra sessão real CONNECTED, QR revision2,
identidade autenticada e centenas de chaves Signal preservadas. O código CP3
05d3d2c/CP4c3933d5 usava o browser padrão do Baileys, sem overrideDesktop.
Esses fatos comprovam um pareamento real anterior; a simples presença de
handlers QR em código ou testes não seria suficiente.

Em `49c2252a5c80075d598588b2f299ed56e0fc2a08`, a captura inicial passou a usar
`syncFullHistory=true` e `Browsers.macOS("Desktop")` antes da autenticação.
As consolidações posteriores conservaram essa combinação. A recuperação da
sessão já vinculada continuava usando outra configuração; não validou o
primeiro pareamento novo. A correção firstqr-686a852 tratou os estados/limites
corretamente, mas manteve a configuração Desktop, portanto não eliminou esse
defeito de protocolo.

No SDK **7.0.0-rc14 instalado**, `getWebInfo` anuncia DARWIN somente quando
syncFullHistory é true e o tuple é Mac OS/Desktop. O userAgent continua WEB.
O gerador também muda DeviceProps para DESKTOP. Projeção offline com as
credenciais iniciais reais da QA, somente por leitura, sem socket/QR/mutação,
produziu:

| Configuração | webSubPlatform | DeviceProps | requireFullSync |
| --- | --- | --- | --- |
| Web histórico, padrão SDK | WEB_BROWSER | CHROME | false |
| Publicação anterior, overrideDesktop | DARWIN | DESKTOP | true |
| Correção, padrão SDK com bootstrap | WEB_BROWSER | CHROME | true |

A [implementação RC14](https://github.com/WhiskeySockets/Baileys/blob/v7.0.0-rc14/src/Utils/validate-connection.ts)
explica a diferença. O [relato primário2677](https://github.com/WhiskeySockets/Baileys/issues/2677)
registra fechamento428 antes de QR ao anunciar Desktop/DARWIN, enquanto
WebBrowser funciona sob a mesma revisão/rede. É evidência externa compatível
com a regressão concreta local; a aceitação remota deste ambiente só pode ser
comprovada no novo gesto humano. SDKrc14 mantido. A função oficial instalada fetchLatestWaWebVersion retornou
2,3000,1050149611 em13/10/2026, com isLatest=true e somente HTTP público.
A publicação atualiza o pin operacional para essa revisão comprovada,
exclusivamente em primeiro pareamento autorizado; não busca versão no startup
nem altera os transportes já autenticados. Não é tentativa aleatória nem prova
de que a revisão anterior era a causa.

## Percurso real auditado

1. Providers é montado com chave de usuário/organização/permissões. O cliente
   REST usa a sessão atual do Core, sem organizationId que conceda autoridade.
   Troca de contexto desmonta subscriptions/QR e aborta requests.
2. A ação Vincular lê a conexão; reutiliza canal existente ou cria via outbox.
   Create/prepare_link precisam concluir antes do connect versionado. Não há
   segundo connect por refresh ou resposta409; removedOnPhone nunca é inferido.
3. Core verifica sessão/Origin/CSRF/Membership/providers.manage, versão,
   idempotência e escopo; grava ProviderCommand/auditoria em transação.
4. Worker adquire lease, reautoriza ator/sessão/contexto, chama create idempotente
   e command HMAC com mesma identidade/controlVersion; recibo COMPLETED é
   execução administrativa, não QR nem autenticação.
5. Sessions grava autorização de120s antes da rede; allowPairing=true só no
   escopo novo explicitamente autorizado. Auth inicial persiste criptografada
   antes de makeWASocket; nenhuma credencial da organização antiga é reutilizada.
6. Factory registra creds.update/connection.update imediatamente após criação,
   antes de aguardar HistoryImporter.recover. QA não tem operação histórica:
   recover não aguarda rede nem bombeia histórico. Nenhuma evidência de operação
   secundária bloqueando o eventoQR nesta tentativa.
7. EventoQR válido chega ao actor serial, incrementa qrRevision e emite
   connection.updated/QR_REQUIRED. Valor fica só em memória com prazo20s.
   Worker reconcilia snapshot recente, sem usar replay antigo para regredir.
8. Chat consulta REST após realtime; QR_READY/revisão atual/sem comando pendente
   dispara GET QR autenticado. Core reautoriza após leitura do Provider, confere
   tenant/estado/revisão/prazo e retorna no-store. Chat confere revisão e tempo
   monotônico, renderiza SVG real em memória e limpa ao expirar/desmontar.
9. Scan/creds/isNewLogin autentica dentro do gesto120s;515 permite só uma
   conclusão de transporte, sem novo QR. CONNECTED exige eventoopen do SDK e
   transporte ativo; estabilidade continua30s. Falha terminal não é reenviada.

## Até onde a tentativa humana chegou

Quatro gestos humanos após firstqr: CONNECTING → SOCKET_CREATED → WS_OPEN →
WS_CLOSED/TRANSPORT_WS_CLOSED → FAILED, entre03:03:51 e03:05:24UTC de13/10.
Tempo entre open e close ~0,27–0,51s. Último lastDisconnect428/WS_CLOSED.
QAattempts9/recoveryFailures5/qrRevision0/sem identidade/keys0/desiredfalse;
cinco comandosconnectCOMPLETED com uma tentativaoutbox cada,18eventos técnicos.
Zero QR_REQUIRED, zero autenticação, zero mensagens; backend atual verifica
pairingEligibletrue. Organização antigaFAILED10, separada e preservada.

| Pergunta | Conclusão sustentada |
| --- | --- |
| WebSocket inicia? | Sim, WS_OPEN observado em quatro tentativas. |
| Handshake começa? | SDK inicia validateConnection no open; etapas internas não eram registradas. |
| Etapa do428? | Depois de open, antes de qualquer eventoQR; fronteira interna exata desconhecida nos logs anteriores. |
| Encerramento remoto ou local? | EventoWSclose precede tratamento local terminal; sem timeout30s/120s, stop ou outro comando anterior. Motivo remoto exato não conservado. |
| Callback no momento certo? | Sim, registrado antes do awaitimporter; loop assíncrono socket só inicia após turnoJS. |
| QR emitido/descartado? | Não há evidência de emissão; qrRevision0 e ausênciaQR_REQUIRED. |
| Provider→Core ou Core→Chat perdeu esse QR? | Não havia QR para transportar nessas tentativas. Ambos receberam falha/snapshot recente. |
| Browser/versão/histórico? | Desktop+full altera efetivamente DARWIN; regressão introduzida por49c2252. Revisão pública atual1050149611 observada pela função oficial instalada; pin anterior1050063423. A causalidade da versão para428 não é comprovada. |

## Correções mínimas

- Retirar somente o overrideDesktop em baileys.ts, restaurando identidadeWeb
  padrão SDK. Manter syncFullHistory/reader limitado e todas as proteções.
- Logger SDK com hook que **não encaminha argumentos, serializers ou mensagens**.
  Labels exatos instalados geram apenas códigos internos permitidos. Unknowns
  são descartados; trace continua desativado. Nada de frames/QR/auth/Signal.
- Eventos técnicos de criação/WS/primeiroframe/registro/offer/QR/credenciais/
  autenticação/finalização/localclose, com hash técnico de escopo e geração.
  Não criar uma máquina persistida nem um segundo gerenciador de sessão.
- No Chat, leitura coalescida antes ignorava eventoRealtime ocorrido durante
  GET antigo. O fallback30s podia perder QR de20s. Uma pendência efêmera garante
  uma leitura adicional depois da atual; só uma em voo, sem comando automático,
  polling novo ou estado antigo substituindo versão recente. Cleanup por tenant.

## Localizar uma próxima falha sem material privado

Por hash de escopo/geração/horário no log do Provider, verificar sequência:
AUTH_READY → SOCKET_CREATED → WS_OPEN/HANDSHAKE_START →
HANDSHAKE_FRAME_RECEIVED → REGISTRATION_READY → PAIRING_OFFER_RECEIVED →
QR_RECEIVED → QR_REQUIRED → AUTH_PERSISTED/PAIRING_ACCEPTED → AUTHENTICATED.
A ordem de WS_OPEN vs HANDSHAKE_START depende da ordem dos listeners do SDK.
REGISTRATION_READY prova que respostaHandshake foi decodificada e Noise avançou
até preparar registro; não prova aceitação pelo servidor. OFFER é stanza recebida,
QR_RECEIVED é updateSDK; QR_REQUIRED é persistência do estado, não armazenamento
QR. LOCAL_SOCKET_CLOSE distingue intervenção local e sua ordem relativa ao
fechamentoWS/SDK_SOCKET_END. WS_CLOSED_ABNORMAL preserva categoria1006 sem reason.
Se a sequência parar antes de offer, investigar transporte/protocolo; depois de
QR_RECEIVED e antesQR_REQUIRED, autorização/persistência; depoisQR_REQUIRED,
Worker/Core/HTTPstatus/revisão/Chat. Nunca copiar frames, QR ou credenciais.

## Verificação e segurança

Executar suítes existentes, lint/typecheck/build/Prisma/OpenAPI/CI. Apenas
asserções de configuração/projeção/privacy e reconciliação existentes ajustadas;
nenhuma nova bateria/cenárioQR fictício. Não confundir consistência de código
com QR real funcional. Backup fresco e restauração isolada obrigatórios antes
do deployProvider; nunca restaurar Signal sobre sessão viva ou zerar contadores.
Publicar só Provider/Chat se contratos e Worker/Core permanecerem compatíveis.
Homologação real exclusiva do usuário após publicação autorizada.
