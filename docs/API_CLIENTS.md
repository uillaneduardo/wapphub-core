# API, Contratos e Clientes

## Princípio

O WappHub Core é a autoridade de domínio e expõe contratos consumíveis por múltiplos clientes.

Clientes previstos:
- WappHub Chat Web;
- WappHub Platform;
- futuro WappHub Chat Android nativo;
- ferramentas internas autorizadas.

Nenhuma regra essencial deve existir apenas no frontend web.

## Versionamento

API pública entre os próprios produtos deve nascer versionada:

```
/api/v1/...
```

Mudanças incompatíveis exigem estratégia explícita de versão/migração.

## OpenAPI

O Core deve manter OpenAPI como contrato REST oficial.

Objetivos:
- documentação;
- geração de tipos/clientes quando adequado;
- testes de contrato;
- reduzir divergência entre repositórios.

## Realtime

O contrato WebSocket/eventos também deve ser versionado/documentado.

Eventos não devem depender de detalhes internos de ORM.

## Bootstrap

Prever endpoint agregado para reduzir round trips dos clientes:

```
GET /api/v1/app/bootstrap
```

Pode retornar:
- User;
- Organization atual;
- Membership;
- permissions;
- entitlements;
- configurações básicas;
- resumo de canais;
- preferências visuais.

Não incluir segredos.

## Android futuro

O app Android deve consumir a mesma API de domínio do Chat Web.

Requisitos arquiteturais desde já:
- endpoints independentes de HTML;
- DTOs estáveis;
- paginação por cursor;
- uploads independentes do navegador;
- realtime documentado;
- autenticação capaz de suportar clientes nativos;
- idempotência/clientMessageId;
- tratamento consistente de offline/reconexão.

Não criar lógica exclusiva no backend "só para o navegador" se for regra de domínio.

## Compatibilidade

Web e Android podem possuir UX diferente, mas devem produzir os mesmos comandos e respeitar:
- Organization Context;

## API do Demo Provider (branch de revisão M1)

- `GET /api/v1/providers` lista DEMO e META; META é apenas IN_DEVELOPMENT.
- `PUT /api/v1/providers/demo` altera estado com `providers.manage` e CSRF.
- `GET /api/v1/providers/demo/contacts` e `POST /api/v1/providers/demo/messages` são ferramentas autenticadas sob `providers.simulate`.
- O contato externo é derivado do vínculo atual Organization/Channel/ContactIdentity; clients não podem escolher remetente ou tenant.
- Envio e histórico continuam nos endpoints comuns de Conversation/Message. Consulte `docs/DEMO_PROVIDER.md`.
- RBAC;
- entitlements;
- capabilities;
- auditoria;
- isolamento multi-tenant.

## Contrato entregue no M0

`docs/openapi.json` é gerado dos schemas Fastify e servido em
`GET /api/v1/openapi.json`. Respostas de erro usam `{error: {code, requestId}}`.

| Método | Rota sob /api/v1 | Função |
|---|---|---|
| GET | /health | Liveness |
| GET | /health/ready | MariaDB + Redis |
| POST | /auth/login | Sessão + csrfToken |
| POST | /auth/logout | Revogação da própria sessão |
| GET | /me | Identidade, contexto selecionado e restituição de csrfToken |
| GET | /me/organizations | Organizações com Membership ativa |
| POST | /session/organization | Seleção/troca de contexto autorizado |
| GET | /app/bootstrap | User, Organization, Membership, permissions |

Login e comandos exigem Origin permitido. Comandos autenticados exigem também
cookie e header `X-CSRF-Token` vinculado à sessão. `GET /me` restitui csrfToken
apenas quando o cookie CSRF corresponde ao hash armazenado; senão retorna null.
Bootstrap exige contexto selecionado e permission `organization.read`.
Não há contratos de Chat/Meta/mídia/entitlements no M0. Exemplo de configuração
e execução em `LOCAL_DEVELOPMENT.md`.

## Contratos M1 backend

Contacts, Conversations, Messages internas, Tags, Notes, assignment, transferência,
recibos locais e sync compõem a extensão de /api/v1, sem v2 ou frontend.
Todos os endpoints e schemas constam do OpenAPI gerado. O WebSocket é
read-only, usa sessão existente/Origin/contexto e possui contrato próprio em
REALTIME_CONTRACT.md. Cursores e clientMessageId são independentes de HTML.
Autenticação nativa/Android não foi implementada.

Na branch `feat/m1-team-roster`, `GET /api/v1/team/members` lista somente
Memberships e Users ativos da Organization da sessão, com `userId`, nome,
email, status e `canReceiveAssignment`. Requer `conversations.assign` ou
`conversations.transfer`; cursor e limite seguem o formato `{items,nextCursor}`.
Esse contrato ainda não foi integrado nem implantado.
