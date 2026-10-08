# Contrato inicial realtime — M0

M0 não abre WebSocket nem publica eventos operacionais. O módulo
`src/realtime/contract.ts` reserva o envelope de versão 1 para M1:

| Campo | Contrato |
|---|---|
| version | literal 1 |
| eventId | identificador ordenável; implementação definida no M1 |
| organizationId | tenant autorizado, resolvido no servidor |
| type | código estável; nenhum tipo operacional implementado no M0 |
| entityId | identificador público da entidade |
| occurredAt | data UTC ISO 8601 |
| payload | DTO versionado, sem ORM/segredos |

A implementação futura deve autenticar sessão e Membership ativa antes de
assinar qualquer escopo, segmentar por Organization/conversa/usuário e impedir
broadcast global. Troca de contexto deve abandonar escopos e cache anteriores.
Reconexão precisará de sincronização por lastEventId; WebSocket não é histórico.
Nenhum mecanismo de polling é introduzido pela fundação.
