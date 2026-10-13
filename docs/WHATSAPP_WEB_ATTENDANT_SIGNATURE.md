# Assinatura automática do atendente — implementação e validação

Data: 2026-10-13. PR37 integrada à main41861c4 e publicada; separador único validado conforme novo pedido do usuário. Os registros da revisão original abaixo são históricos.
A proposta abaixo foi aprovada expressamente pelo usuário antes da implementação.
Código local implementado; produção não alterada nesta entrega.
Revisão em [PR37](https://github.com/uillaneduardo/wapphub-core/pull/37), draft,
branch `feat/whatsapp-attendant-signature`; commit funcional
`57bf2becd27c602a2670834d8e39e23eada29ada`. Nenhum merge automático.

## Resultado solicitado

Novas mensagens de saída iniciadas por um usuário autenticado pelo Core no
canal WhatsApp Web terão o seguinte texto transmitido:

```text
*Nome do Atendente*
Mensagem original
```

Representação exata: `*${nomeNormalizado}*\n${bodyOriginal}`.
`body`, `senderUserId`, `senderName`, IDs e DTOs continuam com a semântica atual.
Somente `transmittedBody` contém o texto assinado. `senderName` permanece o
nome de exibição atual associado ao autor persistido; renomeação posterior
não altera o snapshot do texto transmitido.

## Gate e autorização

[`AGENTS.md`](../AGENTS.md) exige A0/A1 → proposta A2 → uma aprovação do usuário
antes de implementar/refatorar funcionalidades.
[`WHATSAPP_WEB_CONSOLIDATION_EXECUTION.md`](WHATSAPP_WEB_CONSOLIDATION_EXECUTION.md),
fase A2, determina: **“Parar neste gate e pedir uma única aprovação da proposta
ao usuário.”** O pedido atual solicita explicitamente seguir os gates antes de
implementar. O usuário aprovou expressamente A2 e autorizou implementação e testes
sintéticos nesta conversa. Deploy, migrations em produção, pareamento e envios
reais seguem excluídos pelo usuário. Publicação e homologação são gates futuros.

## A0 — main versus produção comprovada

Workspace inicial limpo. Main local e remoto confirmados em
`701f634e545898c4690e9b01241938dc9266f821`, por `git rev-parse` e `git ls-remote`.
Branch da proposta: `docs/a2-attendant-signature-20261013`.

| Processo | Imagem executada | Revision OCI |
| --- | --- | --- |
| Core API | `wapphub-core:firstqr-686a852` | `686a85256fb93cad48d6ec677675b40ea5474f62` |
| Core Worker | `wapphub-core:p0link-e6aa1c6` | `e6aa1c6faea23abb88aa02246e611a640f752fa3` |
| Provider Web | `wapphub-provider-web:qrfix-06fafb6` | `06fafb659999a1155555180b0c6b70ca54c5bf32` |
| Chat | `wapphub-chat:qrfix-dbab1ae` | `dbab1aec709b9a3026079ad3dbce1d2dabfd7192` |

Docker inspect confirmou imagens, labels, início e caminhos Compose reais.
API/Worker usam `compose.yml` + `compose.provider-web.yml` do Core; Provider
usa os overlays de integração/recuperação existentes, sem reconfiguração.

`git diff 686a852..main` e `git diff e6aa1c6..main`, restritos a `chat.ts`,
`web-provider-worker.ts`, `web-sync.ts` e `provider-outbound.ts`, estão vazios.
Main possui correções posteriores de pareamento/diagnóstico no adapter e um
ajuste em `web-connections.ts` desde a revisão do Worker. Desde a revisão
publicada do Provider, main só acrescenta documentação. Não promover revisões
antigas ou tratar main como retrato integral do runtime.

Hashes SHA256 dos artefatos compilados lidos diretamente em API e Worker são
iguais entre ambos:

| Artefato | SHA256 |
| --- | --- |
| `dist/src/application/chat.js` | `a54bac06c49c1089977e3f1f667763e44c17107676d59e34f203f3422d217dfe` |
| `dist/src/application/web-provider-worker.js` | `59a32451cfc5bd833a76d6fd188ce7b5cc1436d2ef5c9a8ccd447bcb59bd9adb` |
| `dist/contracts/provider-outbound.js` | `07a28b06ad3d298eb06724365142248b055dff7efc3e107cf956c1c2af278c21` |

Às 13:00Z os seis serviços estão healthy. SQL somente leitura mostra uma
conexão CONNECTED com outbound/media true e outra FAILED com capacidades false;
dez comandos send existentes (oito COMPLETED/dois FAILED), nenhum comando
pendente/em processamento e zero mensagens históricas. Core/Worker têm gates
web/outbound/media true e execução histórica false. O relatório QR anterior
registrava duas conexões FAILED às 04:42Z: a leitura atual prevalece, sem inferir
homologação humana. Nenhuma consulta ao WhatsApp ou envio foi executado.

## A1 — fluxo existente e lacunas

| Existente | Lacuna | Alteração mínima | Prova/teste |
| --- | --- | --- | --- |
| Foundation autentica `User`; Chat revalida sessão/Membership/RBAC em transação | Nome ainda não participa do texto enviado | Consultar `User.name` do `c.userId` autorizado na transação de criação | Autor autenticado; nome forjado pelo cliente não influencia assinatura |
| `Chat.send` cria Message e ProviderCommand na mesma transação | `transmittedBody` é igual a `body` | Montar assinatura uma vez antes da criação e persistir no campo existente | Corpo/DTO originais, snapshot e outbox atômicos |
| Worker usa `message.transmittedBody ?? message.body ?? ""` | Nenhuma lacuna para transmitir assinatura persistida | Conservar esta expressão e autorização de despacho | Capturar SendIntent real do Worker em fixture sintética |
| SendIntent limita `body` a 8000 | Assinatura pode ultrapassar limite após a validação REST | Reutilizar a validação do campo `sendIntentSchema.shape.body` no Core, antes de persistir | 8000 aceito; 8001 rejeitado, sem Message/command/mídia vinculada |
| Idempotência consulta Message antes de criar ou reativar comando | Recalcular assinatura em retry causaria drift de digest | Assinar somente mensagem nova; retries usam snapshot salvo | IDs/digest/texto iguais após renomeação e falhas |
| `WebSync` compara `old.body` com `originalBody` recebido | Eco remoto assinado seria conflito | Para Message OUTBOUND com `senderUserId`, comparar conteúdo remoto com texto transmitido persistido; manter comparação atual para demais origens | Eco live/histórico válido reconcilia; conteúdo divergente continua rejeitado |
| Adapter usa `intent.body` como texto ou legenda IMAGE/VIDEO | Core ainda não prepara legenda assinada | Aplicar regra ao texto de legendas, sem criar texto para mídia vazia | Imagem/vídeo com e sem legenda atravessam Worker e adapter sintéticos |
| DTO resolve `senderName` por relação User | Nenhuma lacuna | Manter serializer e relações | Mesmo autor antes/depois do eco; renomeação só afeta exibição |

O helper opcional `presentText` em `contracts/provider.ts` produz `Nome: texto`,
tem política compartilhada e não é chamado no fluxo Web de saída. Alterá-lo
espalharia esta regra de negócio para consumidores de outro contrato. A proposta
usa um helper pequeno na application do Core, sem alterar esse contrato.

Adapter instalado envia legendas em IMAGE/VIDEO. AUDIO/VOICE não têm legenda
no transporte atual; esta entrega aplica a regra às legendas suportadas sem
criar mensagens adicionais nem prometer texto em áudio. DOCUMENT é aceito no
contrato canônico de ingresso, mas não no upload atual. Não ampliar capabilities.

## A2 — comportamento mínimo proposto

1. Executar o fluxo atual de autenticação, Membership, permissões, conversa,
   canal e capability. Resolver idempotência existente primeiro.
2. Somente para criação de mensagem nova WhatsApp Web com texto, ler `User.name`
   do `c.userId` autorizado dentro da transação. Não usar nome do responsável
   da conversa, contato, Owner do canal ou campo enviado pelo cliente.
3. Normalizar apenas a cópia do nome usada na assinatura: NFC, substituição de
   espaços/quebras de linha Unicode por espaço simples, remoção de controles
   e caracteres invisíveis de formatação (inclusive controles bidi), remoção
   dos delimitadores WhatsApp `*`, `_`, `~` e crase, e trim. Preservar acentos
   e pontuação legítima. Não atualizar `User.name` ou `senderName`.
4. Se o nome ficar vazio após normalizar, rejeitar antes de enfileirar com erro
   seguro `INVALID_ATTENDANT_NAME` (HTTP400), sem inventar identidade. Mídia
   sem texto não precisa de assinatura nem dessa validação de nome.
5. Montar `*nome*\nbody` preservando cada caractere do body original.
   Em mídia com body vazio ou só espaços, não acrescentar assinatura;
   conservar o conteúdo original sem produzir legenda artificial.
6. Validar o texto final com o campo body do contrato SendIntent existente.
   Excesso retorna `MESSAGE_PRESENTATION_TOO_LONG` (HTTP400) antes de gravar.
   Limite de 8000 segue a unidade usada pelo Zod instalado (code points Unicode), inclusive
   emojis; não truncar mensagem nem assinatura para fazê-la caber.
7. Gravar `transmittedBody` na mesma transação de Message/outbox. Preservar
   body, IDs, autoria, mídia, auditoria, eventos e resposta existentes.
8. Não reconstruir assinatura no Worker, replay de PROCESSING, retry explícito
   NOT_SENT ou pedido repetido com clientMessageId. Mensagens já enfileiradas
   antes da mudança mantêm seu texto persistido, inclusive sem assinatura.
9. Ajustar somente a comparação do eco de saída com autor interno em WebSync:
   conteúdo externo deve corresponder ao snapshot transmitido, com fallback
   legado para body e equivalência de ausência de legenda na mídia vazia.
   Manter verificações de tenant/channel/providerMessageId/conversa/direção/
   tipo/mídia. Não remover prefixos recebidos ou inferir autoria por texto.
   Corpo, transmittedBody e senderUserId nunca são sobrescritos pelo eco.

Fluxo de dados:

```text
Sessão autenticada + Membership/RBAC → Chat.send
                                      ├─ retry: snapshot existente
                                      └─ novo Web: User.name → normalização
                                           → assinatura + limite
                                           → Message + ProviderCommand (commit)
                                                   ↓
Worker (snapshot + reautorização) → SendIntent existente → adapter
                                                   ↓
Eco/receipt → WebSync (comparação com transmittedBody) → status/realtime
```

| Canal/origem | Assinatura nesta entrega |
| --- | --- |
| WhatsApp Web, nova saída do atendente, texto | Sim |
| WhatsApp Web, nova saída IMAGE/VIDEO com legenda | Sim |
| WhatsApp Web, mídia sem texto | Sem prefixo/legenda artificial |
| WhatsApp Web, recebidas/DEVICE/históricas/eco | Não adicionar; eco só reconcilia |
| Notas, mensagens internas e Demo | Comportamento existente |
| Meta futuro | Nenhuma mudança |

## Arquivos previstos

- `src/application/chat.ts`: invocar composição/validação só na criação Web;
  usar `User.name` do autor autenticado e persistir snapshot.
- `src/application/outbound-signature.ts`: helper puro pequeno para normalizar
  nome e compor/validar o texto; nenhuma nova camada, serviço ou configuração.
- `src/application/web-sync.ts`: comparação restrita do eco já descrita.
- Testes unitários do helper e expansão de `tests/web-provider.test.ts`;
  reforçar testes existentes do adapter para legendas quando necessário.
- Documentação de comportamento e progresso; STATUS somente após validação,
  distinguindo implementação local de publicação/homologação.

`web-provider-worker.ts` e `contracts/provider-outbound.ts` foram auditados;
o comportamento existente atende à proposta e não requer mudança funcional.
Nenhuma migration, endpoint, DTO REST, evento realtime, novo campo de provider,
dependência, SDK, fila, alteração de Chat UI ou estado produtivo é necessária.

## Testes e gates após aprovação

| Caso | Assertivas relevantes |
| --- | --- |
| Texto e normalização | Formato exato, acentos, CR/LF/Unicode, delimitadores/controles/bidi; body e User.name intactos; nome vazio rejeitado |
| Limites | Texto final com 8000 e 8001, legenda e emojis; rollback sem Message/comando/vínculo de mídia |
| Autoria | Dois atendentes distintos; autor diferente do responsável da conversa; senderName sem prefixo; payload não escolhe assinatura |
| Nome alterado após fila | Worker transmite nome anterior; próxima mensagem usa novo nome; senderName segue relação atual |
| Idempotência | Pedido repetido e concorrente com mesmo clientMessageId gera uma Message/outbox; body/autor/mídia diferentes retornam conflito |
| Reenvio/restart/incerteza | NOT_SENT autorizado reusa IDs e texto; falha SQL após envio e replay PROCESSING conservam digest; UNKNOWN não retransmite |
| Legendas | IMAGE/VIDEO com texto, vazio e só espaços; mesma mídia/ID; captura de intent e payload SDK sintéticos |
| Eco | Live e replay histórico do texto/legenda assinados reconciliam a mesma Message, sem alterar autoria/body/snapshot; eco alterado permanece conflito |
| Exclusões | INBOUND, DEVICE, histórico importado, notas, interno, Demo e fila legada sem assinatura permanecem iguais |
| Multi-tenant e autorização | Dois tenants/nomes/canais; clientMessageId igual por escopo; usuário multi-Organization; sem Membership/permissão; sessão/contexto revogado no despacho; nenhuma saída fora do escopo |

Executar novas provas e suítes pertinentes somente no ambiente isolado com
schema terminado em `_test`, conforme `LOCAL_DEVELOPMENT.md`. Reutilizar
transporte/HTTP/HMAC/Vault sintéticos existentes, sem socket WhatsApp real.
Depois rodar lint, typecheck, build, suíte Core/Provider, validação Prisma/
OpenAPI e drift exigidas pelo repositório. Registrar falhas e sucesso sem
enfraquecer asserções; não declarar homologação com mocks.

Baseline desta auditoria: Node22.22.1; `tsx --test tests/provider-contract.test.ts`
**9/9 aprovados**. Não foram criados ou executados os testes novos acima nesta
fase A, e os testes antigos não comprovam a funcionalidade proposta.

## Riscos, alternativas e rollback

- A assinatura ocupa parte do limite contratual: mensagens longas que antes
  cabiam poderão ser rejeitadas antes da fila. Truncamento descartado para
  preservar integralmente o texto original.
- Normalização pode reduzir um nome malformado a vazio: rejeição explícita
  evita usar e-mail/ID ou nome genérico como autoria.
- Não calcular assinatura no Worker: rename/retry mudaria o digest e poderia
  conflitar com o recibo durável do Provider.
- Não detectar assinatura por prefixo do body: texto original pode começar
  legitimamente com nome ou markdown; idempotência vem da Message/outbox.
- O ajuste de eco é necessário para integração; sua condição deve ser estreita
  e testar conflitos, sem relaxar autoria ou isolamento de ingressos externos.
- Rollback futuro deve reverter a criação de novas assinaturas mantendo o
  Worker que usa snapshots e a comparação de eco compatível com assinaturas
  já gravadas. Nunca reescrever mensagens ou recriar comandos/digests em fila.
  Qualquer publicação/rollback depende de autorização específica posterior.

## Implementação após aprovação

O diff funcional está restrito a `chat.ts`, `outbound-signature.ts` e
`web-sync.ts`. O helper normaliza somente a cópia do nome de assinatura;
Chat consulta User.name na transação autorizada e grava transmittedBody antes
do commit. O caminho de mensagens existentes continua anterior à composição,
preservando snapshots inclusive em retry explícito e fila legada sem assinatura.
Worker, DTO, schema e contrato outbound permanecem iguais à base.

WebSync utiliza o snapshot somente para Message OUTBOUND já persistida com
senderUserId; as demais origens continuam comparadas com body. A equivalência
entre legenda sem texto (ausente, vazia ou somente whitespace) e eco sem texto
é igualmente restrita a essa autoria local e tipo de mídia. Identidade, conversa, direção, tipo, hash/size de mídia e
transmittedBody explícito continuam verificados; corpo e autoria não são
reescritos na reconciliação live ou histórica.

Inspeção da versão instalada **Zod4.6.5** corrigiu uma premissa da proposta:
`z.string().max(8000)` conta **code points Unicode**, não unidades UTF-16 de
String.length. O helper reutiliza exatamente esse validador; os testes cobrem
8000/8001 com emoji tanto para texto quanto legenda. Nenhum limite contratual
foi alterado. A assinatura e as duas quebras entram na contagem final.

Testes novos exercitam normalização/injeção, rollback de limite/nome inválido,
idempotência concorrente, nome de exibição versus snapshot, conflitos reais de
eco (inclusive rejeição histórica), isolamento de tenants, troca de Organization,
legendas IMAGE/VIDEO/vazia/espaços e fila legada com snapshot/null. O percurso
HTTP/HMAC/Vault existente agora comprova envio assinado e rename antes de
dispatch/retry, sem nova chamada de transporte no replay. O teste do adapter
instalado verifica texto assinado após restart e caption/IDs/bytes exatos usando
socket SDK e mídia privados inteiramente sintéticos.

## Resultados locais da implementação inicial

| Check | Resultado |
| --- | --- |
| Core, suíte completa final | **143/143**, sem skips/falhas |
| Provider, suíte completa | **137/137**, sem skips/falhas |
| Lint/typecheck/build Core e Provider | Aprovados |
| OpenAPI | Validado e idêntico aos schemas atuais; sem alteração de contrato |
| Prisma/schema/migrations isoladas | Schema válido; 12 migrations já aplicadas, nenhuma nova migration |
| Drift isolado | Zero novo desvio; cinco diferenças legadas de nomes de FK preservadas |
| Diff/produção | `git diff --check` aprovado; mesmos IDs/imagens/inícios dos seis containers produtivos, todos healthy |

Core executado via `scripts/m1-test.sh run --rm --no-deps`, código/dependências
do workspace montados em container do projeto isolado e banco
`wapphub_m1_test`/Redis próprios. Provider executado localmente com fixtures
temporárias, socket SDK substituído e bytes sintéticos. Nenhum teste conectou
conta WhatsApp. A suíte Core final inclui cinco testes unitários novos e quatro
cenários de integração novos, além das assertivas ampliadas no percurso existente;
Provider acrescenta uma prova de captions e reforça a prova de texto/restart.

Evidências: `/home/uillan/homelab/deploy-records/wapphub-provider-web/20261013-attendant-signature/`:
`core-full-final.log`, `provider-full.log`, `core-{lint,typecheck,build}-final.log`,
`core-contract-schema.log`, `core-full.log` (142/142 antes da última ampliação),
`core-web-first.log` (45/46 antes de corrigir id obrigatório da fixture de mídia).
Também houve invocação focada inválida que omitiu o teste de criação do channelId;
a invocação foi corrigida para a suíte integral, sem retirar testes/assertivas.
Typecheck inicial corrigiu o retorno discriminado de SyncItem na fixture e o
id obrigatório da Media. Teste de emoji identificou a premissa errada sobre
UTF-16, corrigida pela inspeção do validador instalado, sem relaxar o limite.

Riscos operacionais permanecem os da proposta: assinatura consome orçamento
dos8000caracteres; nome sem conteúdo após sanitização retorna400; AUDIO/VOICE
não ganham suporte novo a legenda; mídias/IDs seguem contratos existentes.
Rollback de código deve manter reconciliação de ecos assinados e snapshots
já persistidos, desativando somente a composição de novas assinaturas.

CI da PR acionada nos workflows Core/Provider; resultados finais devem ser
conferidos nos checks do head vigente e no relatório local da entrega.
Pendências: revisão da PR, eventual integração e autorização específica de
publicação; depois, homologação humana. Não há check local obrigatório pendente.
Nenhum deploy/restart, migration produtiva, pareamento ou envio real foi
executado. Não declarar esta feature publicada ou homologada.

Próximo passo: revisão/CI antes da publicação;
deploy e homologação real não são autorizados por esta implementação.

## Ajuste final PR37 — legenda somente whitespace

Revisão solicitada pelo usuário após aprovação da implementação principal.
O caso foi reproduzido: snapshot/body com espaços versus eco sem legenda
retornava PROVIDER_IDEMPOTENCY_CONFLICT. A correção altera somente a comparação
em WebSync para Message OUTBOUND com senderUserId e tipo de mídia: ausência,
string vazia e whitespace reconhecido por String.trim são equivalentes quando
ambos os lados não contêm texto. Igualdade exata continua aceita; qualquer
legenda textual divergente permanece em conflito. Não há sanitização/escrita
de body/transmittedBody nem relaxamento dos demais campos de identidade/mídia.

Quatro cenários de integração novos cobrem IMAGE/VIDEO com espaços e whitespace
Unicode, eco omitido/vazio/espaços originais, texto divergente, deduplicação,
IDs/autoria e campos originais preservados. Legados têm provas separadas para
transmittedBody null (fallback body) e snapshot vazio. Negativas comprovam que
eco omitido de legenda textual local e mídia DEVICE sem autoria local continuam
rejeitados. Provider e contratos não foram alterados nesta revisão.

Evidências da revisão: `~/homelab/deploy-records/wapphub-provider-web/20261013-attendant-whitespace-review/`.
regression-before.log registra dois conflitos reproduzidos; regression-after.log
registra5/5 (inclui bootstrap da fixture). Revalidação completa da revisão:
**Core147/147 e Provider137/137**, sem skips/falhas; lint/typecheck/build dos dois
pacotes, OpenAPI/Prisma/drift aprovados novamente. Logs core-full.log,
provider-full.log e core/provider-{lint,typecheck,build}.log preservados no
diretório da revisão. Provider sem alteração de arquivo em relação ao head d7f37f9.
PR continua draft; CI será conferida no head atualizado e os resultados finais
preservados no relatório local, sem merge/deploy ou interação real WhatsApp.


## Ajuste solicitado após PR37 — separador único

Única mudança de comportamento: novas mensagens e legendas textuais usam `*nome*\nbody`, mantendo negrito WhatsApp. Corpo original preservado inclusive espaços, Unicode e linhas em branco próprias. Não reescrever `transmittedBody` já persistido; retries e ecos mantêm snapshots anteriores com duas quebras, inclusive após renomeação. `senderName`, autoria, IDs, contratos e restante do envio permanecem intactos. Mídia sem texto segue sem assinatura. Limite de8000codepoints continua sobre texto final: prefixo de nome A agora ocupa quatro caracteres. Testes existentes atualizados para texto/IMAGE/VIDEO, limites e pass-through Provider; fixture legada inclui assinatura antiga de duas quebras. Sem migrations ou envio real de teste.

Validação do ajuste: Core149/149 e Provider14/14 nos testes afetados, zero falhas/skips. A suíte completa Provider138/138 validou separadamente a recuperação; o ajuste de assinatura não modifica código de envio do Provider. Unitários5/5 incluídos na suíte Core. Texto/legendas IMAGE/VIDEO, limite8000, Unicode/whitespace, snapshots antigos assinados/não assinados, renomeação, retry/eco/idempotência/autoria/tenancy cobertos. Evidências em20261013-whatsapp-recovery/core-full.log e provider-signature-pass-through.log.

Lint/typecheck/build e Prisma/drift/OpenAPI aprovados; contratos/schema sem alteração. Nenhuma migration em produção.
