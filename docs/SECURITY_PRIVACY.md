# Baseline de Segurança, Autenticação e Privacidade

## Escopo

Este documento estabelece requisitos mínimos de engenharia. Ele não substitui análise jurídica, contratos, política de privacidade ou programa formal de conformidade LGPD.

## Identidade

`User` é identidade global.

Não armazenar senha reversível.

Senhas devem usar algoritmo de hash apropriado e parâmetros atualizáveis. A implementação deve permitir rehash futuro.

E-mail deve possuir fluxo de verificação quando necessário para ativação/convites e recuperação.

## Sessão web

Preferência arquitetural:
- sessão server-side;
- identificador aleatório de alta entropia;
- cookie HttpOnly;
- Secure em produção;
- SameSite apropriado;
- sem identificador de sessão em URL;
- revogação server-side imediata.

Evitar tokens long-lived em localStorage como mecanismo principal da aplicação web.

Armazenar hash do token de sessão quando aplicável.

## Organization Context

`currentOrganizationId` é contexto, não autorização.

Toda requisição protegida valida novamente:
1. sessão;
2. User ativo;
3. Membership ativa;
4. permission;
5. entitlement;
6. regra de domínio.

## Session management

Prever:
- expiração absoluta;
- expiração por inatividade conforme política;
- lastSeenAt;
- revoke;
- "encerrar outras sessões";
- revogação após eventos sensíveis;
- regeneração de sessão quando apropriado.

## Recuperação de conta

Reset token:
- aleatório;
- uso único;
- expiração curta;
- armazenado com proteção adequada;
- invalidado após uso;
- respostas públicas não devem facilitar enumeração de usuários.

## Brute force e abuso

Aplicar controles em:
- login;
- forgot-password;
- reset-password;
- invite acceptance;
- endpoints de autenticação.

Incluir rate limiting e observabilidade de eventos suspeitos.

## MFA

Arquitetura deve permitir MFA.

Antes de abertura comercial, avaliar obrigatoriedade para:
- WappHub Admin;
- Owner;
- ações críticas.

## CSRF/CORS/headers

Como a aplicação web usa cookie de sessão:
- proteger operações mutáveis contra CSRF;
- CORS restritivo;
- CSP e security headers apropriados;
- HTTPS obrigatório em produção.

## Security Events

Separar de AuditEvent quando fizer sentido.

Exemplos:
- LOGIN_SUCCESS
- LOGIN_FAILED
- PASSWORD_CHANGED
- RECOVERY_REQUESTED
- SESSION_REVOKED
- MFA_ENABLED
- MFA_DISABLED
- SUSPICIOUS_LOGIN

Nunca registrar senha/token/segredo.

## Segredos Meta

- criptografia em repouso;
- rotação/versionamento de chave previstos;
- não logar;
- não retornar ao cliente após gravação;
- mascarar exibição;
- limitar acesso pelo princípio do menor privilégio.

## Multi-tenancy

Isolamento é requisito de segurança primário.

Testes negativos obrigatórios devem provar que Organization A não acessa:
- Conversation de B;
- Message de B;
- Media de B;
- Contact de B;
- Channel de B;
- configuração de B.

## Logs e minimização

Não registrar conteúdo pessoal desnecessário.

Sanitizar logs e erros.

Definir retenção distinta para:
- Application Logs;
- Security Events;
- Audit Events;
- Integration Events;
- Sessions;
- Invitations;
- Messages/Media conforme contrato/política.

## LGPD / privacy by design

Princípios de engenharia:
- finalidade;
- necessidade/minimização;
- controle de acesso;
- rastreabilidade;
- retenção definida;
- possibilidade futura de atender solicitações de titulares conforme papel contratual;
- documentação de suboperadores/providers quando aplicável.

Os papéis jurídicos WappHub/contratante devem ser formalizados separadamente.

## App Android futuro

Clientes móveis não alteram as regras de segurança.

O app Android deverá usar fluxo de autenticação apropriado para cliente nativo, armazenamento seguro de credenciais/tokens e revogação server-side.

Não reutilizar automaticamente no Android pressupostos de cookie/browser sem desenho específico de autenticação móvel.

## Políticas implementadas no M0

- Sessão MariaDB: tokens aleatórios de 32 bytes, somente SHA-256 persistido.
- Política padrão: 12 horas absolutas e 30 minutos de inatividade, configuráveis.
- Cookie HttpOnly/SameSite=Strict; Secure e prefixo __Host- em produção.
- CSRF: Origin exato em toda operação mutável, JSON validado no login e token
  aleatório vinculado à sessão em comandos autenticados. Token legível em cookie
  CSRF e restituível por /me para clientes web após reload.
- Login: 10 tentativas/minuto/IP compartilhadas por Redis; falha do limitador
  bloqueia a operação. Proxy headers não são confiados por padrão.
- Password hash: scrypt versionado, N=65536/r=8/p=1, salt de 16 bytes.
- User/Organization/Membership ativos e permissions revalidados no servidor.
- Logout encerra somente a sessão autenticada, inclusive com Membership revogada.
- SecurityEvent: LOGIN_SUCCESS, LOGIN_FAILED (anônimo), SESSION_REVOKED.
- AuditEvent tenant-scoped: seleção de contexto e bootstrap administrativo.
- Segredos: base AES-256-GCM, versão da chave e escopo tenant autenticado por AAD.
- API: payload limitado a 16 KiB, CORS exato, headers Helmet, cache no-store,
  erros padronizados e logs sem corpo/querystring/credenciais/exceções internas.

Contas são provisionadas por bootstrap explícito, sem senha padrão. Recuperação
de senha, MFA e controles operacionais de retenção não possuem fluxo implementado
no M0; requisitos conceituais acima permanecem para milestones apropriados.
HTTPS e configuração de proxy confiável são requisitos do deploy de produção.
Evidências de testes negativos estão em `tests/foundation.test.ts`.

## Preparação Cloudflare M0

O perfil de deploy mantém `trustProxy=false` e não confia globalmente em headers
X-Forwarded-*. O rate limiting pode usar CF-Connecting-IP somente de conexões
cujo IP real do socket esteja na lista explícita CLOUDFLARED_TRUSTED_IPS.
O valor do header precisa ser um IP válido; peers não confiáveis e headers
malformados mantêm o orçamento pelo IP da conexão. CIDRs/wildcards não são
aceitos. O header nunca autoriza acesso a Organization ou domínio.

Em produção, cookie Secure e prefixo __Host- independem de headers de protocolo.
WEB_ORIGINS contém somente origens HTTPS de clientes web autorizados, nunca a
URL da API por ela ser o endpoint público. Uma lista vazia bloqueia comandos
web e não concede CORS a nenhuma origem; health/readiness continuam públicos.
Sem cliente autorizado no M0, não habilitar automaticamente um frontend futuro.
Procedimento e evidências HTTPS do hostname oficial estão em `DEPLOYMENT.md`.

## M1 backend

REST de Chat revalida contexto/Membership/permissions e sempre filtra o tenant.
FKs compostas protegem relacionamentos operacionais. Comandos PATCH/DELETE
seguem as mesmas regras CSRF/Origin dos POST. Transferência aplica limites de
histórico também ao replay; notas anteriores ficam ocultas em LIMITED/NONE.
Supervisão exige permissions explícitas e é auditada.

WebSocket read-only usa cookie de sessão e Origin exato no upgrade, sem JWT ou
token em URL. Guarda periódica não estende lastSeenAt; revogação/contexto/estado
inválido encerra sockets. Logout/troca de contexto invalidam conexões no próprio
fluxo REST. Stream persistente entrega somente IDs autorizados. Antigo atendente
recebe somente a invalidação da transferência pelo seu escopo de usuário.
A validação inicial M1 não alterou produção M0; depois houve promoção M1/Demo
controlada. Testes mutáveis continuam exclusivos ao ambiente isolado, conforme
LOCAL_DEVELOPMENT.md. Achado atual de autorização de prévias A1 em
M1_ARCHITECTURE_ACCEPTANCE_20261008.md impede aceite integral desta policy.


## Correção local de autorização de prévias — P0

Metadados de Conversation não concedem leitura de Message. list/detail/preview
usam messages.read e o mesmo visibleFromMessage do histórico; supervisor só
bypassa limites com a permission de leitura. Ausência de mensagem autorizada
retorna preview null; não há corpo no realtime. Policy unificada implementada e
validada localmente (58 testes Core), ainda não publicada; ver
P0_PREVIEW_AUTHORIZATION.md. O achado A1 acima é registro histórico da versão
publicada, que permanece vulnerável até deploy específico autorizado.


## WhatsApp Web CP4

Sessão real preservada; histórico operacional opt-in por escopo exato, janela30dias
e volumes cumulativos limitados. PN/LID não implica telefone; nomes não fundem
identidades. Histórico tardio respeita fronteiras LIMITED/NONE e previews. Referências
de mídia não contêm binários/chaves. Logs contêm métricas/códigos, nunca conteúdo.
Estas proteções não substituem a política de retenção administrativa da organização.
Ver WHATSAPP_WEB_CHECKPOINT4.md e relatório de deploy para evidências.

Diagnósticos de providers exigem `providers.manage` + `providers.diagnostics.read`, são somente leitura tenant/conexão e retornam projeções permitidas. Não expõem corpos, telefones, JIDs/LIDs, QR, auth, payloads nem stack. Exportação utiliza a mesma projeção sanitizada. Detalhes adicionais são limitados a 64 por conexão e 30 dias no checkpoint existente; os hashes Inbox continuam para deduplicação. Não há alteração de visibilidade do domínio ou autoria por prefixos de texto.
