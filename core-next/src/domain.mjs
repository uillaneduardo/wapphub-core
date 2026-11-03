export class DomainError extends Error {
  constructor(code, status, message) {super(message);this.name="DomainError";this.code=code;this.status=status}
}
export function assertTextMessage(input){
  if(!input||typeof input!=="object")throw new DomainError("invalid_request",422,"Corpo inválido");
  if(typeof input.clientMessageId!=="string"||input.clientMessageId.length<8||input.clientMessageId.length>128)throw new DomainError("invalid_idempotency_key",422,"clientMessageId inválido");
  if(input.type!=="text")throw new DomainError("unsupported_type",422,"Apenas texto no M1");
  if(typeof input.body!=="string"||!input.body.trim()||input.body.length>4096)throw new DomainError("invalid_body",422,"Mensagem deve ter 1 a 4096 caracteres");
  return {clientMessageId:input.clientMessageId,type:"text",body:input.body.trim(),replyToMessageId:input.replyToMessageId??null};
}
export function assertEdit(input){
  if(!input||typeof input.body!=="string"||!input.body.trim()||input.body.length>4096)
    throw new DomainError("invalid_body",422,"Texto inválido");
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)
    throw new DomainError("invalid_revision",422,"Revisão esperada inválida");
  return {body:input.body.trim(),expectedRevision:input.expectedRevision};
}
export function authorizeConversation({actorId,organizationId,members,conversation}){
  if(!actorId||!organizationId||!conversation||conversation.organizationId!==organizationId)
    throw new DomainError("not_found",404,"Conversa não encontrada");
  if(!members.some(m=>m.userId===actorId&&m.organizationId===organizationId&&m.status==="active"))
    throw new DomainError("forbidden",403,"Acesso negado");
  if(!conversation.participants.some(p=>p.userId===actorId&&p.active))
    throw new DomainError("forbidden",403,"Acesso negado à conversa");
  return true;
}
export const envelope=(type,data,{organizationId,conversationId,cursor,eventId,occurredAt})=>({
  eventId,type,organizationId,conversationId,cursor,occurredAt,data
});
