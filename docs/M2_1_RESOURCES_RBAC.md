# M2.1 — catálogo e permissões por Membership

Escopo: catálogo global imutável em código e administração tenant-scoped de
permissões. Nenhuma assinatura/entitlement comercial, convite, edição de perfil,
Platform ou integração Meta implementada.

## Catálogo

`src/domain/resources.ts` define recursos, contexto, nome/descrição, disponibilidade,
permissions, dependências, base e entitlement opcional. Recursos AVAILABLE são
base e não exigem contrato comercial; futuros PLANNED/RESEARCH não podem conceder
permissions. Entitlement é null até existir contrato; código falha fechado para
permissions sem recurso base lançado ou com entitlement não resolvido. Não há
registros de recurso duplicados por Organization nem endpoint para editar catálogo.
Códigos documentados reutilizados: chat.text, conversation.assignment/transfer/
archive/supervision/internal_notes/tags, whatsapp.status e calling.audio.
Etiquetas são funcionais dentro das conversas; navigation=false porque a página
de catálogo ainda é placeholder. Arquivos/configurações separados permanecem
PLANNED. A consulta do catálogo inclui futuros para contexto do editor; navegação
Chat só apresenta recursos AVAILABLE com navigation=true e permissions efetivas.

## Resolver e perfis

Permissões efetivas = (RolePermission + GRANT) - REVOKE, filtradas pelo catálogo
lançado. Revogação prevalece. Foundation, Chat.context, roster, destinatário de
atribuição e realtime usam a mesma resolução. Membership/User/Organization ativos,
sessão server-side e objeto tenant-scoped continuam obrigatórios. Nenhuma regra
M1 de prévias, mensagens, notas, FULL/LIMITED/NONE, supervisão ou Demo foi relaxada.

Matriz existente preservada, incluindo assign/transfer do AGENT. Novas operações:
team.read padrão OWNER/SUPERVISOR; team.permissions.manage padrão OWNER.
installChatRBAC é apenas bootstrap administrativo, não caminho de requisição.
Nome de perfil não autoriza requisições. OWNER é identificado unicamente para a
invariante de último Owner funcional, não como substituto de permission.

Concessão/revogação é individual por Membership, com FK composta por tenant.
organization.read não editável: é a fundação de contexto. Ator não pode alterar
seu próprio vínculo (inclusive reset) nem delegar/editar authority ausente das suas
permissions efetivas. Concessões globais/desconhecidas/futuras, duplicadas ou
conflitantes são rejeitadas. team.permissions.manage depende de team.read.
Último Owner funcional exige User/Membership ativos e organization.read, team.read
e team.permissions.manage efetivas. Não há API de role/status para contornar isso.

## Escrita, auditoria e concorrência

PUT substitui o conjunto inteiro de overrides; expectedVersion é obrigatório.
Lock Organization existente serializa com mutações M1; autorização revalidada após
lock em READ COMMITTED. Revisão divergente retorna 409 sem alterar dados/auditoria.
Membership.permissionVersion incrementa; overrides e AuditEvent com targetMembershipId,
before/after (codes e version, sem e-mail/senhas/tokens) persistem na mesma transação.
Falha na publicação Redis não desfaz commit: revalidação periódica lê autoridade DB.
O reset remove overrides, também com revision/lock/auditoria/invariantes.

## REST /api/v1

- GET /resources — contexto ativo, organization.read; catálogo global.
- GET /permissions — team.permissions.manage; operações disponíveis/editabilidade.
- GET /team/directory — team.read; membros da Organization, estado/perfil, cursor assinado.
- GET /team/members/:membershipId/permissions — team.permissions.manage; herança,
  grants, revocations, effective e version. Membro externo retorna 404.
- PUT /team/members/:membershipId/permissions — team.permissions.manage + Origin/CSRF;
  body {expectedVersion, grants, revocations}.
- POST /team/members/:membershipId/permissions/reset — mesmos controles;
  body {expectedVersion}.

Roster operacional GET /team/members mantém contrato/permissões do M1.
Bootstrap e seleção de Organization acrescentam resources e membership.permissionVersion;
permissions passa a conter o conjunto efetivo. Extensões aditivas para o Chat M1.
OpenAPI gerado/validado no modo produção é o contrato oficial. Todos os DTOs
omitirem ORM/segredos; schemas recusam campos extras e payloads inválidos.

## Sessões/realtime

REST resolve autoridade em cada operação, sem cache de permissões. Gateway lê
version + assinatura efetiva antes de stream e novamente antes de entregar batch.
Após mudança, encerra conexões afetadas com close code 4003 (não é logout).
Wake-up Redis pós-commit acelera; guarda periódica 1s detecta sinais perdidos.
Mudanças de papel por operação administrativa externa também alteram assinatura.
Operações já autorizadas/em trânsito antes do commit não podem ser desfeitas;
novas operações e batches revalidam o estado vigente.

/api/v1/session/updates é um WebSocket read-only com Origin/cookie/contexto e
organization.read, sem payload de domínio. Permite receber invalidação inclusive
sem conversations.read; não concede acesso ao stream de chat. Sessões simultâneas
na Organization afetada são revalidadas; sessão em outro tenant conserva isolamento.
Logout/contexto/suspensão continuam usando fechamento 1008 existente.

Chat trata 4003 encerrando/abortando escopo antigo, descartando checkpoints da conta,
reconsultando sessão/bootstrap e desmontando conteúdo enquanto revalida. Conteúdo
remonta por User/Organization/permissionVersion. Guarda respostas antigas via revisão;
StrictMode e retorno de foco/visibilidade também revalidam, sem polling REST frequente.

## Migration e recuperação

202610090001_membership_permission_overrides é aditiva: revision, unique index
tenant+membership, tabela overrides, metadados nullable de auditoria e duas novas
permissions/RolePermissions. Nenhuma permission M1 removida e nenhuma migration
histórica alterada. Validar migrate deploy/diff em banco _test e, antes de produção,
backup com gzip/hash e restauração isolada seguida de ensaio da migration sobre
snapshot real, comparando matriz antiga/contagens.
Comparação DB→schema detecta cinco diferenças preexistentes de nomes de FK no
Demo (nomes curtos das migrations versus nomes compostos inferidos pelo Prisma),
sem diferenças em ações/colunas. Diff antes/depois é byte a byte idêntico.
`db:validate-drift` exige esse diff exato e rejeita qualquer drift adicional;
fixture em scripts/expected-m1-foreign-key-names.txt NÃO é SQL a executar.
Não corrigir relações/migrations históricas do provider neste escopo. Sem db push/reset/drop de dados.

Após uso de overrides, NÃO retornar a Core antigo que os ignora. Recuperação deve
preservar o resolvedor: manter nova versão saudável/corrigir por forward deploy;
isolar somente API/Worker em falha crítica se necessário, preservando DB/Redis.
Retorno a imagem M1 só é admissível com zero overrides, após confirmar que não
reintroduz permissões revogadas. Sem reversão destrutiva da migration/restauração
sobre produção. Chat anterior pode servir de contingência com Core M2.1 mantendo
backend como autoridade; não tem editor M2.1 nem revalidação dedicada 4003.

## Validação

Arquivos backend executam em sequência porque fixtures compartilham Role/Permission;
testes de concorrência HTTP continuam simultâneos via Promise.all. Suites M1
integrais mantidas, com snapshot OpenAPI estendido para rotas novas. Testes novos
cobrem defaults, grants/deny/reset/auditoria, tenant/self/global/future, último Owner
inclusive concorrente, REST/CSRF/revisão, providers/destinatário e duas sessões
realtime + acesso ao canal de controle após revogar conversations.read.

Homologação de fluxos no navegador é exclusiva do usuário; nenhuma validação
visual/funcional autenticada em navegador foi feita no homelab.
