# M2 — Plano técnico incremental: SaaS e Entitlements

## Origem, estado e sequência

Proposta de implementação, **nenhum código/API/migration abaixo foi implementado**.
Escopo preserva exatamente M2 de `MILESTONES.md`, apoiado em FEATURES, DOMAIN,
ARCHITECTURE, SECURITY_PRIVACY e AGENTS. Não muda ordem de milestones nem inclui
Meta, mídia, cobrança recorrente, onboarding comercial M5 ou Android.

M1 permanece operacional, mas não encerrado: resolver A1 (prévia/autorização),
A2 (checkpoint/aplicação) e aceites pendentes em
`M1_ARCHITECTURE_ACCEPTANCE_20261008.md` antes de iniciar desenvolvimento M2.
Reconciliação Git é recomendada antes da base M2; main remota não é produção.

Primeira entrega funcional M2 recomendada após essa barreira: **M2.1 catálogo
comercial aditivo e contratos tipados**, sem ativar bloqueios nas operações M1.
É pequena, testável e prepara o resolver sem misturar convites/frontends.

## Dependências explícitas

| Entrega | Depende de | Resultado |
| --- | --- | --- |
| M2.1 Catálogo e base de autorização Admin | M1 corrigido/aceito + base Git reconciliada | Product/Plan/Feature/PlanFeature |
| M2.2 Assinaturas, add-ons e overrides | M2.1 | Fonte comercial tenant-scoped |
| M2.3 Entitlement Resolver explicável | M2.2 | Direitos efetivos e leituras/bootstrap aditivos |
| M2.4 Assentos e convites concorrentes | M2.3 | Membership ativa somente com capacidade |
| M2.5 Enforcement e canais contratados | M2.3 + M2.4 | Autoridade comercial backend em comandos |
| M2.6 WappHub Admin + Minha Conta mínimos | M2.1–M2.5 | UX sobre os contratos já validados |
| M2.7 Personalização e aceite integrado | M2.6 | accentColor, plano interno R$0 e aceite final |

Cada entrega em PR próprio, testes/contratos/revisão antes da seguinte. Migrations
numeradas com timestamp futuro real, em arquivos novos; nomes abaixo são propostas,
nunca comandos para aplicar em produção. Dados existentes não serão removidos.

## Invariantes comuns

Backend decide `Permission AND Entitlement AND Provider Capability AND Business Rule`
quando aplicável, após sessão/User/contexto/Membership ativos. Operações internas
sem provider não consultam capability fictícia. Frontend recebe explicação e
pode adaptar UX; nunca decide por nome/preço do plano, role ou valor em localStorage.
Demo não consome channels.whatsapp e Meta não é habilitada por contratar canais.

Organization e produto são chaves do contexto comercial. Membership continua
User↔Organization, User não recebe role/organizationId global. Catálogo é global;
assinatura/override/consumo e suas respostas são tenant-scoped. Identidade Admin
WappHub deve ser explícita e separada das permissions OWNER de cliente.
Todas as APIs seguem /api/v1, schemas fechados, Origin/CSRF, erros `{error:{code,
requestId}}`, paginação por cursor e DTOs sem tokens/ORM. OpenAPI acompanha cada PR.

## M2.1 — Catálogo comercial aditivo

**Objetivo/responsabilidades:** module application/commercial/catalog e domain
para valores tipados; repositories Prisma; controllers finos. Product define
produto por code estável; Plan pertence a Product e aceita preço zero; Feature
possui code global estável, tipo BOOLEAN/QUANTITY/USAGE/CONFIG e estados previstos;
PlanFeature associa feature/valor ao plano com unicidade. Feature pode possuir
productId para delimitar compatibilidade do catálogo; não associar feature de
outro produto a plano. Reservar users.seats e channels.whatsapp para produto Chat.

**Migrations propostas:** `m2_commercial_catalog`: Product, Plan, Feature,
PlanFeature e índices/FKs. Price em minor units inteiro não negativo + currency
BRL (0 representa R$0,00); nunca float para dinheiro. Valor tipado validado por
feature, campos/JSON fechados, inteiro não negativo para QUANTITY. Feature.code
único e imutável; Product.code único; Plan (productId,code,revision) único;
PlanFeature (planId,featureId) único. Publicação congela revisão de plano; mudança
cria nova revisão de Plan com novo ID, sem entidade distribuída/versionamento
arquitetural amplo. Tipo/code não mudam após referência publicada. Desabilitar globalmente uma
Feature usada por assinaturas ativas (especialmente capacidade) não é PATCH
livre de catálogo: negar alteração direta que modifique direitos correntes e
usar revisão de oferta + transição controlada de cada assinatura sob lock de
Organization. DEPRECATED impede novas concessões conforme policy, sem reduzir
silenciosamente limites existentes.

**APIs propostas:** GET/POST/PATCH `/admin/products`, `/admin/features`,
`/admin/plans` e respectivos /:id; PUT/DELETE `/admin/plans/:id/features/:featureId`;
POST `/admin/plans/:id/publish`. PATCH/DELETE apenas draft ou desativação segura,
sem remover entidades referenciadas. Gestão não exige mudança de código para
associar features; definir feature nova não implementa comportamento de domínio.

**Autorização/isolamento:** propor grants explícitos `platform.catalog.manage`
no controle Admin mínimo. Suporte físico pequeno `PlatformAdminGrant`
(userId,permissionId,status) ou equivalente dedicado é proposta a revisar, não
role global em User nem autorização por OWNER do cliente. API Admin valida sessão
ativa e grant explícito a cada comando; provisionamento inicial somente por
procedimento administrativo autorizado, sem grant automático a usuários existentes.
Feature/Plan globais não podem revelar assinaturas de outras Organizations.

**Concorrência/idempotência/auditoria:** revisão/If-Match (ou expectedVersion)
em updates para evitar perda de alteração; keys de criação com fingerprint de
payload e conflito 409. Catálogo publicado imutável elimina downgrade global
concorrente por edição de PlanFeature. Audit administrativo distingue scope
PLATFORM de tenant, sem inventar organizationId de cliente. Migration aditiva de
AuditEvent: scope e organização nullable com validação de consistência; linhas
M1 existentes ficam scope ORGANIZATION e mesma semântica. Registrar actor,
resourceId, ação/versionamento e alteração mínima, sem conteúdo sensível.

**Testes/aceite:** zero preço, duplicidade de codes, tipo/quantidade inválidos,
associação cross-product negada, grant Admin negado a OWNER comum, CSRF e conflito
de revisão. Admin API cria produto/plano/feature e associa sem alterar código;
M1 completo permanece com os mesmos payloads e permissões.

**Compatibilidade/rollback:** migration apenas aditiva; code M1 ignora catálogo.
Rollback de imagem para M1 compatível sem apagar novas tabelas, enquanto não
ativado enforcement nem novas escritas de auditoria incompatíveis. Testar leitura
M1 contra schema novo e validar serialização de auditoria antes de permitir
rollback; não presumir downgrade seguro só por ser aditivo.

## M2.2 — Subscription, add-ons e Organization overrides

**Objetivo/entidades:** Subscription pertence à Organization, Product e revisão
imutável Plan; status ACTIVE/SUSPENDED/CANCELLED/EXPIRED; effectiveFrom/effectiveTo
UTC, revision. SubscriptionAddon declara Feature, operação tipada/quantidade,
vigência e origem administrativa. OrganizationFeatureOverride com
ENABLE/DISABLE/SET/ADD, motivo, autor e validade; não depende de plano.nome.

**Migrations:** `m2_subscriptions`: entidades acima, FKs compostas para assegurar
produto/tenant compatíveis; índices por organizationId/productId/status/validade.
Garantir uma assinatura corrente por organizationId/productId via pequena linha
SubscriptionSlot com PK composta e subscriptionId único/nullable, evitando unique
condicional MariaDB por ACTIVE. Pode guardar histórico em Subscription; slot é
ponteiro atual, não nova fonte de entitlement. Add-ons não podem apontar para
assinatura de outro tenant. Override único corrente por (organization,product,
feature), histórico auditável. Campos commercialRevision podem ficar no slot.

**APIs:** Admin POST `/admin/organizations/:id/subscriptions`, PATCH
`.../subscriptions/:subscriptionId` (status/troca de plano com expectedVersion),
PUT/DELETE `.../subscriptions/:id/addons/:featureCode`, PUT/DELETE
`.../entitlement-overrides/:featureCode`. Minha Conta GET `/account/subscription`
usará contexto da sessão. Não criar pagamento/checkout/renovação automática.

**Autorização/tenant:** `platform.subscriptions.manage` e
`platform.entitlements.override` separados de catálogo; Admin deve selecionar
explicitamente organização alvo, validar grant e audit target. Minha Conta exige
permission tenant `account.subscription.read`, nunca aceita organizationId livre.
Admin não bypassa seats ou policy por ter grant comercial.

**Concorrência/idempotência/auditoria:** lock Organization depois Slot sempre na
mesma ordem, expectedVersion/revision, datas/grants revalidados na transação;
resolver/limites serão usados em qualquer diminuição posterior à M2.4. Key de
criação no scope actor/tenant/operação, fingerprint, retorno estável e 409 em
reuso divergente. Auditoria da assinatura/add-on/override e motivo obrigatórios,
transação com domínio; evento/invalidação após commit somente, sem dados comerciais
em broadcast global. Expiração é avaliada por relógio do servidor mesmo sem job.

**Testes/aceite:** assinatura única sob corrida, tenant estrangeiro, vigência/
status, plano de outro produto, atualização perdida/idempotência, add-on/override
sem grant, histórico/audit. Criar assinatura R$0 para Organization WappHub não
gera dívida/job de cobrança nem bypass por nome. Fixtures em banco isolado.

**Compatibilidade/rollback:** tabelas aditivas; nenhuma alteração Message/Channel.
Preencher assinaturas de tenants existentes será operação administrativa separada,
explícita e autorizada, não seed automático no startup. Enquanto enforcement
inativo, preservar operação M1. Após uso, rollback mantém dados comerciais e
retorna só versão compatível; evitar downtime/remoção de tabelas.

## M2.3 — Entitlement Resolver

**Objetivo:** função/service único resolve (organizationId autorizado,productCode,
featureCode,nowUTC,contexto transacional). Fonte da verdade no banco. Não persistir
snapshot efetivo como autoridade; cache opcional só depois de testes/medição.
Primeira versão resolve diretamente no banco e na mesma transação dos comandos.

**Migrations:** apenas índices/versions necessários ao slot e vigências, sem
tabela de duplicação de entitlement. Catálogo, assinatura, add-ons e override
já possuem FKs. USAGE tem limite comercial tipado; contador/periodicidade real
só para comportamento explicitamente implementado, nunca consumo fictício zero.
CONFIG tem schema por feature e merge/replacement definido, sem JSON arbitrário.

**APIs:** GET `/entitlements` no tenant atual; GET
`/admin/organizations/:id/entitlements` para explicação com grant comercial;
bootstrap ganha campo aditivo entitlements (tipo/valor/revision/codes seguros).
Detalhes de overrides e motivos internos só com permission apropriada. Cliente
sem contexto não recebe catálogo efetivo de outro tenant.

**Precedência proposta, sujeita à revisão de contrato:**

1. Feature ACTIVE e Product habilitado; feature DRAFT/DISABLED/DEPRECATED segue
   policy explícita (DEPRECATED existente pode continuar, nova concessão negada).
   Ausência/tipo inválido é deny, não unlimited.
2. Subscription corrente ACTIVE e dentro da vigência; ausência/suspensão/
   cancelamento/expiração não concede recursos. Override não ressuscita assinatura
   suspensa; plano zero ACTIVE é caminho suportado para operação interna.
3. PlanFeature estabelece baseline. BOOLEAN false se ausente, QUANTITY 0 se
   ausente, CONFIG/USAGE indisponível se não configurado. Sem negativos e overflow;
   unlimited, se necessário, precisa representação explícita/versionada,
   não -1/sentinela implícita. M2 inicial pode usar somente limites finitos.
4. Add-ons válidos: ADD apenas QUANTITY/limite USAGE; ENABLE/DISABLE de BOOLEAN
   somente se operação prevista; CONFIG SET explícito, sem merge ambíguo. Resolver
   ordena fontes e rejeita conflitos de SET; somas com overflow são erro seguro.
5. Override corrente vigente é aplicado por último: ENABLE/DISABLE BOOLEAN,
   SET substitui valor tipado, ADD soma quantity. DISABLE vence concessões
   inferiores. Um override por feature/contexto evita empate; operações
   incompatíveis com tipo são rejeitadas na escrita e fail-closed na leitura.
6. Expor effectiveValue, enabled, revision, evaluatedAt, validUntil e reasonCodes,
   breakdown autorizado de baseline/addons/override. Consumption separado de
   entitlement: por exemplo contratado=5, usado=4, disponível=1.

Exemplo: users.seats baseline 3 + addon ADD 2 + override SET 4 = contratado 4;
se usado=4, nenhum assento livre. Não confundir SET final com nova soma. Subscription
suspensa → denied mesmo com override. Plano de preço zero → mesmas regras.

**Autorização/isolamento/concorrência:** authentication/context/membership/
permission antes de resolver/retornar diagnóstico. Dentro de comando com lock
Organization, ler slot/revision/overrides e consumo no mesmo snapshot transacional;
nenhuma mudança comercial pode ultrapassar esse lock. Edição catálogo ativo
somente por nova revisão de plano e troca tenant explícita. Sem cache de permission
na fonte de entitlement. Se cache futuro, chave tenant/product/revision/validade,
invalidação após commit e nunca usado sozinho para consumo concorrente.

**Idempotência/auditoria:** leitura de resolver pura, sem registrar PII/texto a
cada GET; comandos comerciais auditados E2. Denial de quota retorna código seguro
ENTITLEMENT_REQUIRED/LIMIT_EXCEEDED sem revelar outro tenant. Eventos de segurança
para abuso e ações sensíveis, com metadata mínima. GET não pode aumentar consumo.

**Testes/aceite:** matriz tipos/operações/status/relógio/bordas UTC; ausência,
assinatura suspendida, addon expirado, override DISABLE/SET/ADD, conflitos,
quantidade0/overflow, invalidation/revision, tenant A/B. Explicação é determinística
e reproduz valor calculado. Nenhum teste/condicional usa nome de plano para direito.

**Compatibilidade/rollback:** bootstrap aditivo e clientes M1 tolerantes; verificar
schemas, cache e contratos. Campo pode ficar sem consumidor UI até M2.6, mas
nenhum endpoint protegido usa resposta do browser como prova. Rollback do resolver
sem enforcement pode voltar à entrega anterior; após enforcement só versão que
mantém enforcement/semântica de dados. Nunca “rollback” liberando quotas.

## M2.4 — users.seats e convites condicionados

**Objetivo/responsabilidades:** SeatPolicy/InvitationService application únicos
para aceitação, ativação/reativação e provisionamento. Conta Membership ACTIVE
com consumesSeat=true; suspensa/revogada não conta; pendente não reserva/não
consome. User consome em cada Organization, nunca globalmente. Exceção
consumesSeat=false só por operação administrativa explícita, auditada e policy,
não campo manipulável por convite/API de membro.

**Migrations:** evolução aditiva OrganizationInvitation (normalização de email,
updatedAt/version/cancelledAt se necessários), índices para contagem
Membership(organizationId,status,consumesSeat), idempotency record tenant-scoped
com unique(scope,key), payloadHash/resultRef/expiry para comandos que precisem.
Não armazenar token claro; tokenHash permanece único. Entidade existente M0
não significa fluxo comercial já implementado.

**APIs:** POST/GET `/team/invitations`, POST `/team/invitations/:id/cancel`,
POST `/invitations/accept` com token no body, sessão e CSRF; resposta genérica em
pré-validação pública se houver rota dedicada futura. Aceitação autentica User e
valida email exato normalizado do convite + prova de posse enviada ao endereço.
Não usar token em logs/response de listagem/URLs persistidas. Transporte inicial
seguro do convite e identidade verificada devem ser definidos no PR (entrega
manual administrativa controlada ou envio mínimo aprovado); não inventar
integração de e-mail instalada. Se mecanismo de comprovação de endereço não
existir, implementar verificação mínima antes de aceitar; não tratar email de
perfil sozinho como prova. Recuperação ampla/MFA não entram por conveniência.
Permissão proposta `team.invite`, `team.read`, `team.members.manage` separada de
conversations.assign; OWNER recebe por migração RBAC explícita revisada, não role
check no endpoint. Lista não expõe tokens ou assinatura de outros tenants.

**Concorrência crítica:** transação READ COMMITTED, lock da Organization primeiro
(o mesmo lock Chat/alterações de entitlement), depois Slot e Invitation, e ordem
consistente. Revalidar sessão/User/grant de convite vigente, Organization ativa,
tokenHash/email/pending/expiry/role autorizado; resolver users.seats no tx;
contar Memberships ativas consumidoras. Se já existe Membership ativa do mesmo
User, não consumir segunda vez nem alterar role indevidamente. Se capacidade
insuficiente, não criar/ativar Membership nem marcar convite ACCEPTED. Aceitação
vencedora ativa Membership, consome 1 e marca convite/audit no mesmo commit.
Unique(userId,organizationId) e unique token completam proteção, não substituem
lock do COUNT + INSERT. Dois accepts com 1 vaga: só um commit; outro recebe 409
SEAT_LIMIT_EXCEEDED e permanece pendente. Convites criados quando cheio podem
ser negados por UX/regra antecipada, mas pendentes não reservam e aceitação
**sempre** revalida capacidade. Redução de seats/override e reativação também
usam lock da Organization para não correr contra accepts.

**Idempotência/auditoria:** reenvio do mesmo token pelo mesmo User retorna vínculo
aceito sem consumir novamente; token para outro User/email não revela vínculo.
Comando de criar convite com Idempotency-Key scope tenant/actor e fingerprint;
expiração/cancelamento são monotônicos. Auditar CREATED/CANCELLED/ACCEPTED/
MEMBERSHIP_ACTIVATED e exceções de assento; token/PII minimizados. Rate limit
na aceitação, resposta segura, nenhuma autoativação por GET.

**Testes/aceite:** duas aceitações simultâneas e downgrade simultâneo, duplicação
mesmo token/User, email errado, expiry/cancel, roles/grants indisponíveis,
membership suspensa/reativada, sameUser dois tenants, consumesSeat exemptions,
falha após insert com rollback, ataques cross-tenant. users.seats=0 não aceita
membro consumidor. Invite aceito somente com assento livre. Todos os caminhos
administrativos/bootstrap/CLI precisam da mesma policy ou ficar explicitamente
bloqueados ao enforcement; `15dab11` não pode ser integrado como bypass.

**Compatibilidade/rollback:** preexistentes continuam e não são revogadas por
migration. Plano/capacidade inicial deve cobrir ocupação existente antes de gate.
Se downgrade fica abaixo de uso, rejeitar com CAPACITY_IN_USE; não expulsar
pessoas nem perder mensagens. Após accepts, rollback para binário sem SeatPolicy
é inseguro: manter versão compatível e desabilitar só criação de novos convites
como mitigação, não voltar à M1 liberando ativação irrestrita.

## M2.5 — Enforcement do backend e channels.whatsapp

**Objetivo:** inserir commercial guard em casos de uso comuns de mensagens,
assignment/transfer/notes/tags/archive/supervision e futuros comandos de canais,
sem duplicar em controllers ou telas. Relacionar codes de FEATURES com cada
comando; revisar direitos de leitura para não ocultar histórico indevidamente
por perda de direito de escrita. M1 payloads permanecem; 403/409 novos são
compatíveis com erro padronizado e UX deve distinguir permission/quota/capability.

**Migrations:** somente rollout/config/revision aditivos e RBAC granular se
necessário; não criar MetaIntegration/provider real. channels.whatsapp resolve
quantidade contratada, mostra usado/disponível a partir de canais WhatsApp
ativados (hoje nenhum; DEMO não conta). A transição de ativação/reativação
WhatsApp deve reservar/contar dentro do mesmo lock quando M3 existir; guard
puro e teste sintético agora, nenhum endpoint fake de integração externa.

**APIs:** nenhuma API Meta nova. Bootstrap/entitlements/capacity expõem contrato
seguro; endpoints M1 reutilizam payload vigente. /account/capacity pode retornar
contratado/usado/disponível de seats/channels se fizer sentido reduzir roundtrips.
Provider catalog continua META IN_DEVELOPMENT; feature habilitada não configura
credenciais nem indica saúde. Policy exige Permission AND Entitlement AND
capability/configuração AND regra de domínio.

**Autorização/concorrência/idempotência/audit:** resolver+uso no lock e revalidação
de commands; idempotent replay de Message respeita autenticação/visibilidade e
contrato de resposta anterior, sem executar novo envio ou consumir novamente.
Definir no PR se replay de comando concluído retorna resultado após perda de
entitlement (recomendado retorno autorizado, sem nova ação), com testes. Quota
nunca decidida por cache stale. Atualização Subscription/override incrementa
revision e exige comparação de capacidade antes de commit. Registro de mudança
commercial/admissão, sem texto de mensagens em audit ou diagnóstico.

**Rollout/compatibilidade:** preparar catálogo, assinatura interna R$0 e assinatura
explícita compatível para cada tenant existente, com seats>=ocupação e features
M1 atualmente usadas. Relatório read-only de cobertura antes de ativar guard;
sem fallback “sem assinatura=unlimited”. Antes de ativação, configuração server
explícita de rollout M1 continua policy RBAC original; após ativação, fail-closed.
Switch de enforcement é etapa de publicação separada e autorizada, não client
feature flag, trial nem exceção por nome. Não suspender tenants automaticamente.

**Testes/aceite:** cada operação com permissão sem entitlement, entitlement sem
permission, capability false, regra archived/provider disabled; tenants A/B;
contagem de DEMO=0 e WhatsApp sintético/quota; mudanças simultâneas/replay sem
consumo duplicado. Histórico autorizado M1 e payloads continuam compatíveis.

**Rollback:** após ativação, só release compatível com guards e ledger M2. Se
falha, restaurar versão anterior de M2 validada; não restaurar Core M1 sem
controle comercial. Sem migration down ou apagar assinaturas/memberships.

## M2.6 — WappHub Admin mínimo e Minha Conta mínimo

**Objetivo:** wapphub-platform conforme ARCHITECTURE, sem trocar responsabilidades
do Chat. Confirmar existência/estado desse repositório em futura entrega; não foi
incluído nesta auditoria de Core/Chat. Admin gerencia catálogo/publicação,
assinaturas/add-ons/overrides e consulta explicações; Minha Conta vê assinatura,
capacidades e convites conforme permissions. Sem billing checkout/portal externo.

**Migrations/APIs:** nenhuma migration frontend; consumir contratos M2.1–M2.5.
Sessão Core existente, bootstrap e contextos claros; Admin global com grant
próprio, Minha Conta tenant. Se usuário é ambos, UI separa contextos, não envia
organizationId arbitrário como autorização. Backend continua autoridade.

**Concorrência/idempotência/audit:** forms expectedVersion/Idempotency-Key e
busy guard; preservar key em retry incerto, não repetir cobrança/convites. API
retorna conflito para recarregar/revisar; nenhuma regra duplicada por nome de
plano. Auditoria no backend. Não guardar sessão/tokens/rights em localStorage.

**Testes/aceite:** unitários e integração segura de Admin cria catálogo/planfeature/
assinatura e Minha Conta explica seats/canais; nega cliente sem grant e contexto
errado, CSRF, multi-org, erros/idempotência. Homologação manual no notebook após
deploy autorizado; não usar browsers no Homelab. UI de plano R$0 opera igual.

**Compatibilidade/rollback:** Chat segue rotas/fluxos M1 e só utiliza campos
aditivos quando previsto. Frontend Platform versionado pode voltar isoladamente,
Core compatível e guards permanecem. Não usar downgrade do backend para corrigir UI.

## M2.7 — Personalização básica e aceite integrado

**Objetivo:** Organization accentColor mínimo, sem redesign nem upload de logo/
object storage M4. Minha Conta permite editar cor com permission e Core valida.
Plano interno zero usando mesmas entidades e resolver, sem caso especial de WappHub.

**Migrations/APIs:** `m2_organization_branding` adiciona accentColor nullable;
GET/PATCH `/organization/preferences` ou configuração equivalente definida no PR,
permission `organization.settings.manage`, Origin/CSRF. Bootstrap inclui valores
normalizados. Token de cor seguro (ex. hex validado), contraste calculado/validado,
fallback neutro e currentColor nos componentes; não aceitar CSS arbitrário.

**Isolamento/concorrência/idempotência/audit:** dados e versão por Organization
atual, expectedVersion para evitar sobrescrita; PATCH idempotente de mesmo valor,
audit da alteração mínima; invalidar config tenant somente após commit.
Troca de Organization limpa caches/cores da anterior; marca WappHub não é direito
inferido por plano. Sem mídia, DNS, white-label completo ou temas adicionais.

**Testes/aceite:** rejeita cores inválidas/contraste ruim e outro tenant; bootstrap
versão/tema; reset; API grant; cookies/realtime org; toda regressão M1. Em teste
isolado, Admin cria produto/plano/recurso, associa sem código, cria assinatura,
explica resolver; aceita convite só com assento; race de um assento admite só um;
Organization WappHub usa plano R$0; mudanças de direitos refletidas no backend e
UI. Verificação manual de contraste/contexto no notebook com aprovação posterior.

**Rollback:** campo novo nullable com default visual antigo; frontend pode voltar
com Core comercial compatível. Não remover cor/dados comerciais, não desfazer
migrations nem gates para recuperar tela. M2 STATUS concluído só com checklist
de aceite, testes negativos e evidências, nunca por existência de schema.

## Decisões para revisar antes dos respectivos PRs

Precedência tipada de overrides/add-ons, política DEPRECATED, platform grants e
scope de audit, entrega/prova de endereço dos convites, preços/capacidade do
plano interno e migração comercial dos tenants existentes. Estão propostas aqui,
não são decisões comerciais aprovadas nem bloqueios para documentar M2.
Não iniciar desenvolvimento/seed/deploy implicitamente a partir deste plano.

## Gate de publicação futura

Por entrega: lint/typecheck/build, testes DB isolados, autorização/tenant negativos,
concorrência/idempotência, OpenAPI/event contracts, compatibilidade retroativa e
revisão de SQL aditivo. Preparar backup criptografado e restore isolado autorizado,
referências de imagens/rollback compatível e plano de rollout antes de solicitar
deploy. Produção, migrations, seeds e infraestrutura exigem autorização separada.
Não executar scripts local.sh deploy/validate contra produção nesta preparação.
