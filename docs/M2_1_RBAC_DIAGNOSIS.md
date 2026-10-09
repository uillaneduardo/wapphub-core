# Diagnóstico anterior ao schema — M2.1, 2026-10-09

Levantamento realizado antes de qualquer alteração Prisma/SQL.

Produção Core API/Worker: a45fb330ceeb6a703c463174f4fa560ad070e226,
imagem wapphub-core:m1-contacts-a45fb33, healthy. Chat:
2f6c3e626bb591885a1c94d882ff146dd86a03b8,
imagem wapphub-chat:context-navigation-2f6c3e6, healthy.
Clone Core limpo na linha integration/m1-accepted-20261008 (fd766f4),
main remota 1000650 sem Demo/P0/contatos homologados. Branch específica incorpora
ambas as linhas por merge, mantendo código produção e ADR; conflito documental
README resolvido preservando ambas as seções. Não usar a main antiga para deploy.
Chat parte da main atual. Nenhuma alteração local descartada.

## Modelos e autorização

User global, Organization tenant, Membership única por User/Organization;
Role e Permission globais, RolePermission N:N. Papéis somente pela Membership.
Não há overrides, catálogo efetivo ou entitlements persistidos. Foundation.membership
resolve RolePermission por requisição; Chat.context repete a resolução dentro das
transações. Outros usos diretos: roster operacional e validação de destinatário.
Precisam usar o mesmo resolvedor, preservando condições operacionais.

Session: token/CSRF hashed, contexto server-side, expiração/inatividade/revogação,
logout revoga apenas sessão atual. Contexto valida organization.read e membership
ativa; bootstrap retorna permissions. Realtime revalida sessão/contexto e autorização
periodicamente (1s; catch-up 5s) e antes de stream; Redis é wake-up, não autoridade.
AuditEvent atual tem ator/tenant/ação, sem detalhes da alteração. SecurityEvent
registra login/revogação. Não há API para edição de RBAC.

Roster /api/v1/team/members exige conversations.assign OU conversations.transfer,
lista membros ativos aptos para atribuição; manter contrato para compositor.
Providers exige providers.manage; Demo exige providers.simulate e messages.read
nos fluxos atuais. Histórico e prévias exigem messages.read; supervisão não
substitui leitura. FULL/LIMITED/NONE persistidos; não relaxar isolamento ou limites.

## Matriz real de produção (consulta SQL somente leitura)

17 permissions existentes, sem permissions sem vínculos e três Memberships ativas.
OWNER: organization.read; contacts.read/write; conversations.read/create/archive/
assign/transfer/supervise; messages.read/send; notes.read/create; tags.read/manage;
providers.manage/simulate.
SUPERVISOR: mesmo conjunto sem providers.manage/simulate.
AGENT: mesmo conjunto do SUPERVISOR sem conversations.supervise e tags.manage.

Compatibilidade: NÃO remover assign/transfer do AGENT: já homologados.
Nenhuma permission M1 será renomeada, removida ou reinterpretada. Acrescentar apenas
team.read (OWNER/SUPERVISOR) e team.permissions.manage (OWNER), para as novas APIs.
Isso amplia acesso apenas às operações M2.1 novas; roster M1 permanece igual.
Nenhum privilégio global. Concessões individuais limitadas ao catálogo lançado
e às permissions que o ator já possui; alterações no próprio vínculo proibidas,
inclusive restaurar defaults. organization.read é fundação não editável para
não deixar contexto inutilizável. Proteção de último Owner considera também
User/Membership ativos e organization.read/team.read/team.permissions.manage efetivas.

## Migrations existentes

Todas finished, nenhuma rolled_back/pendente na produção:
202610070001_foundation; 202610070002_foundation_relations;
20261008013000_m1_internal_chat; 20261008014000_m1_transfer_audience;
20261008020000_demo_provider; 20261008021000_demo_provider_rbac.
Essas migrations já aplicadas não serão alteradas ou reaplicadas.

Evolução planejada aditiva: revision na Membership, tabela MembershipPermissionOverride
com GRANT/REVOKE e FK tenant composta, detalhes opcionais na auditoria. Sem duplicar
catálogo por Organization. Escrita por transação serializada no lock Organization
já usado pelo M1, optimistic revision para concorrência e auditoria before/after.
Migração deverá ser testada isoladamente antes de backup/deploy.

## Testes e gates

Suites node:test existentes exigem NODE_ENV=test e DATABASE_URL terminada em _test.
Prisma/Redis/testes mutáveis somente em ambiente isolado. Acrescentar testes
negativos tenant/escalonamento/self/último Owner/concorrência, resolução e
propagação para sessões simultâneas, REST/realtime, roster e atribuição M1.
Sem browser no homelab. Deploy somente após checks de ambos os PRs, backup validado
e revisão de compatibilidade; não retornar código que ignore overrides após uso.
