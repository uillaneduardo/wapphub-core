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
