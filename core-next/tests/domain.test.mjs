import test from "node:test";
import assert from "node:assert/strict";
import {assertTextMessage,assertEdit,authorizeConversation,envelope} from "../src/domain.mjs";
test("normalização de texto e idempotência",()=>{
 assert.deepEqual(assertTextMessage({clientMessageId:"client-12345",type:"text",body:"  Olá  "}),{clientMessageId:"client-12345",type:"text",body:"Olá",replyToMessageId:null});
 assert.throws(()=>assertTextMessage({clientMessageId:"a",type:"text",body:"oi"}),{code:"invalid_idempotency_key"});
 assert.throws(()=>assertTextMessage({clientMessageId:"client-12345",type:"image",body:"oi"}),{code:"unsupported_type"});
});
test("revisão concorrente é obrigatória",()=>{
 assert.deepEqual(assertEdit({body:" Novo ",expectedRevision:2}),{body:"Novo",expectedRevision:2});
 assert.throws(()=>assertEdit({body:"oi",expectedRevision:0}),{code:"invalid_revision"});
});
test("isolamento por tenant e participante",()=>{
 const conversation={organizationId:"orgA",participants:[{userId:"u1",active:true}]};
 const members=[{userId:"u1",organizationId:"orgA",status:"active"}];
 assert.equal(authorizeConversation({actorId:"u1",organizationId:"orgA",members,conversation}),true);
 assert.throws(()=>authorizeConversation({actorId:"u1",organizationId:"orgB",members,conversation}),{status:404});
 assert.throws(()=>authorizeConversation({actorId:"u2",organizationId:"orgA",members,conversation}),{status:403});
});
test("event envelope não confunde cursor com sequência",()=>{
 const e=envelope("message.updated",{messageId:"m1",revision:2},{organizationId:"o1",conversationId:"c1",cursor:"opaque",eventId:"e1",occurredAt:"2026-11-03T18:00:00Z"});
 assert.equal(e.cursor,"opaque");assert.equal(e.data.revision,2);
});
