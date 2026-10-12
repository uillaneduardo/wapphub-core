import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { provisionQaPilot } from "../scripts/qa-pilot.js";
import { installChatRBAC } from "../src/application/chat-rbac.js";
import { loadConfig } from "../src/infrastructure/config.js";
import { digest, newToken } from "../src/infrastructure/crypto.js";
import { buildApp } from "../src/http/app.js";
import { DemoProvider } from "../src/integrations/demo-provider.js";
import { MessageIngestionService } from "../src/application/message-ingestion.js";
import { Chat } from "../src/application/chat.js";
import { WebProviderWorker } from "../src/application/web-provider-worker.js";
import { WebProviderClient } from "../src/integrations/web-provider-client.js";
import { Vault } from "../services/wapphub-provider-web/src/vault.js";
import { EventJournal } from "../services/wapphub-provider-web/src/events.js";
import { Sessions } from "../services/wapphub-provider-web/src/sessions.js";
import { InternalAuth } from "../services/wapphub-provider-web/src/auth.js";
import { createHttp } from "../services/wapphub-provider-web/src/http.js";
import type { TransportCallbacks } from "../services/wapphub-provider-web/src/transport.js";
if (process.env.NODE_ENV !== "test" || !new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")) throw Error("ISOLATED_TEST_DB_REQUIRED");
test("QA administrative provisioning is idempotent, isolated and supports explicitly authorized QR/text only", async () => {
 const db = new PrismaClient({log:[]}), config = loadConfig({...process.env,WEB_ORIGINS:"https://web-client.example.test",PROVIDER_OUTBOUND_ENABLED:"true",PROVIDER_MEDIA_ENABLED:"true"}), redis = new Redis(config.REDIS_URL,{maxRetriesPerRequest:1}); redis.on("error",()=>{});
 const directory=await mkdtemp(join(tmpdir(),"wapphub-qa-synthetic-")), key=randomBytes(32), vault=new Vault(join(directory,"sessions"),key); await vault.initialize();
 const journal=new EventJournal(vault), internalKey=randomBytes(32), internal=new InternalAuth(internalKey,join(directory,"nonces")); await internal.initialize();
 let starts=0, sends=0, resolves=0, callbacks!:TransportCallbacks; const pairingPermissions:boolean[]=[], timers:{run:()=>void;delay:number;canceled:boolean}[]=[];
 const source=new Sessions(vault,journal,async (_scope, cb,authorization)=>{pairingPermissions.push(authorization?.allowPairing===true);starts++;callbacks=cb;return {close(){},logout:async()=>undefined,resolveRecipient:async phone=>{resolves++;return {state:"VALID",jid:phone.slice(1)+"@s.whatsapp.net"};},send:async intent=>{sends++;callbacks.receipt(intent.providerMessageId,"READ",intent.destination);}};},true,(run,delay)=>{const timer={run,delay,canceled:false};timers.push(timer);return()=>{timer.canceled=true};},Date.now,()=>{}, {enabled:false,historyEnabled:false,linkedRecoveryOnly:true,outboundEnabled:true});
 const http=createHttp(source,journal,internal),url=await http.listen({host:"127.0.0.1",port:0}),client=new WebProviderClient(url,internalKey),app=await buildApp(config,db,redis,false,undefined,client),chat=new Chat(db,config,async()=>{},new DemoProvider(),new MessageIngestionService()),worker=new WebProviderWorker(db,chat,client);
 const oldOrg=randomUUID(),qaOrg=randomUUID(),oldChannel=randomUUID(),qaChannel=randomUUID(),orgs=[oldOrg,qaOrg],users:string[]=[],sessionIds:string[]=[];
 const origin="https://web-client.example.test";
 const scope=(organizationId:string,connectionId:string)=>({organizationId,connectionId});
 try {
  await db.$transaction(async tx=>{await installChatRBAC(tx);await tx.organization.create({data:{id:oldOrg,name:"Synthetic legacy"}});await tx.channel.create({data:{id:oldChannel,organizationId:oldOrg,provider:"WHATSAPP_WEB"}});});
  const actors:Record<string,{id:string;cookie:string;csrf:string}>={};
  for(const code of ["OWNER","SUPERVISOR","AGENT"]){const user=await db.user.create({data:{email:randomUUID()+"@example.test",name:"Synthetic QA "+code,passwordHash:"synthetic-no-login"}});users.push(user.id);const role=await db.role.findUniqueOrThrow({where:{code}});await db.membership.create({data:{organizationId:oldOrg,userId:user.id,roleId:role.id}});const token=newToken(),csrf=newToken(),session=await db.session.create({data:{userId:user.id,currentOrganizationId:oldOrg,tokenHash:digest(token),csrfHash:digest(csrf),expiresAt:new Date(Date.now()+3600000)}});sessionIds.push(session.id);actors[code]={id:user.id,cookie:"wapphub_session="+token,csrf};}
  const owner=actors.OWNER!,values={ownerUserId:owner.id,organizationId:qaOrg,connectionId:qaChannel};
  const auth=JSON.stringify({me:{id:"synthetic-old@lid"},signedIdentityKey:{private:"synthetic",public:"synthetic"},noiseKey:{private:"synthetic",public:"synthetic"}});
  await source.create(scope(oldOrg,oldChannel));await vault.update(scope(oldOrg,oldChannel),r=>{r.auth=auth;r.keys={synthetic:"retained"};r.attempts=10;r.state="FAILED";r.errorCode="RECONNECT_LIMIT";r.desired=false;});
  const before=JSON.stringify(vault.get(scope(oldOrg,oldChannel))),legacy=await db.contact.create({data:{organizationId:oldOrg,name:"Synthetic old contact",primaryIdentifier:"synthetic:old"}}),thread=await db.conversation.create({data:{organizationId:oldOrg,channelId:oldChannel,contactId:legacy.id}});await db.message.create({data:{organizationId:oldOrg,channelId:oldChannel,conversationId:thread.id,direction:"INBOUND",type:"TEXT",body:"Synthetic legacy",senderContactId:legacy.id}});
  await assert.rejects(provisionQaPilot(db,client,{...values,ownerUserId:actors.AGENT!.id}), /QA_OWNER_NOT_AUTHORIZED/); assert.equal(await db.membership.count({where:{organizationId:qaOrg}}),0);
  const ready=client.ready.bind(client);client.ready=async()=>false;await assert.rejects(provisionQaPilot(db,client,values),/QA_PROVIDER_NOT_READY/);client.ready=ready;assert.equal(await db.organization.count({where:{id:qaOrg}}),0);
  await assert.rejects(provisionQaPilot(db,client,{...values,connectionId:oldChannel}));assert.equal(await db.organization.count({where:{id:qaOrg}}),0);assert.equal(await db.membership.count({where:{organizationId:qaOrg}}),0);assert.equal(starts,0);
  const results=await Promise.all([provisionQaPilot(db,client,values),provisionQaPilot(db,client,values)]);assert.equal(results[0]!.channelId,results[1]!.channelId);assert.equal(results[0]!.membershipId,results[1]!.membershipId);assert.equal(await db.organization.count({where:{id:qaOrg}}),1);assert.equal(await db.channel.count({where:{organizationId:qaOrg}}),1);assert.equal(await db.auditEvent.count({where:{organizationId:qaOrg,action:"QA_PILOT_PROVISIONED"}}),1);assert.equal(starts,0);assert.equal(sends,0);assert.equal(resolves,0);assert.equal(JSON.stringify(vault.get(scope(oldOrg,oldChannel))),before);
  for(const code of ["SUPERVISOR","AGENT"]){const role=await db.role.findUniqueOrThrow({where:{code}});await db.membership.create({data:{organizationId:qaOrg,userId:actors[code]!.id,roleId:role.id}});}
  const request=async(code:string,method:"GET"|"POST"|"PUT",path:string,payload?:object,status=200)=>{const a=actors[code]!;const r=await app.inject({method,url:"/api/v1"+path,headers:{origin,cookie:a.cookie,"x-csrf-token":a.csrf},payload});assert.equal(r.statusCode,status,r.body);return r.json();};
  for (const code of ["OWNER","SUPERVISOR","AGENT"]) await request(code,"POST","/session/organization",{organizationId:qaOrg});
  const organizations=await request("OWNER","GET","/me/organizations");assert.ok(organizations.organizations.some((o:{id:string})=>o.id===qaOrg));await worker.runConnection(scope(qaOrg,qaChannel));
  assert.equal((await request("OWNER","GET","/providers/whatsapp-web/connections")).connection.lifecycle.pairingEligible,true);assert.equal((await request("OWNER","GET","/contacts")).items.length,0);assert.equal((await request("OWNER","GET","/conversations?scope=all")).items.length,0);await request("OWNER","GET","/conversations/"+thread.id,undefined,404);
  for(const code of ["OWNER","SUPERVISOR","AGENT"]){const boot=await request(code,"GET","/app/bootstrap");assert.equal(boot.organization.id,qaOrg);assert.equal(boot.permissions.includes("providers.manage"),code==="OWNER");assert.ok(boot.permissions.includes("messages.send"));assert.equal(boot.permissions.includes("conversations.supervise"),code!=="AGENT");}
  await request("SUPERVISOR","GET","/providers/whatsapp-web/connections",undefined,403);await request("AGENT","GET","/providers/whatsapp-web/connections",undefined,403);
  const read=async()=> (await request("OWNER","GET","/providers/whatsapp-web/connections")).connection;
  await vault.update(scope(qaOrg,qaChannel),r=>{r.state="FAILED";r.errorCode="RECONNECT_LIMIT";r.attempts=5;r.recoveryFailures=5;r.desired=true;r.pairingAuthorization={commandId:randomUUID(),expiresAt:Date.now()-1};});
  await source.recover();await worker.runConnection(scope(qaOrg,qaChannel));assert.equal(starts,0);assert.equal((await read()).lifecycle.pairingEligible,true);
  await db.providerConnection.update({where:{organizationId_channelId:{organizationId:qaOrg,channelId:qaChannel}},data:{lastCheckedAt:new Date(Date.now()-31000)}});
  await request("OWNER","POST",`/providers/whatsapp-web/connections/${qaChannel}/commands`,{action:"connect",commandId:randomUUID(),expectedVersion:(await read()).version},409);assert.equal(starts,0);await worker.runConnection(scope(qaOrg,qaChannel));
  const id=randomUUID();await request("OWNER","POST",`/providers/whatsapp-web/connections/${qaChannel}/commands`,{action:"connect",commandId:id,expectedVersion:(await read()).version});assert.equal(starts,0);await worker.runConnection(scope(qaOrg,qaChannel));assert.equal(starts,1);assert.ok(vault.get(scope(qaOrg,qaChannel))?.pairingAuthorization);
  assert.equal((await read()).state,"CONNECTING");assert.equal(vault.get(scope(qaOrg,qaChannel))?.recoveryFailures,5);assert.equal(vault.get(scope(qaOrg,qaChannel))?.attempts,6);
  callbacks.connection({state:"close",code:428});await source.settle(scope(qaOrg,qaChannel));await worker.runConnection(scope(qaOrg,qaChannel));assert.equal((await read()).errorCode,"PAIRING_TRANSPORT_CLOSED");assert.equal(vault.get(scope(qaOrg,qaChannel))?.desired,false);
  await request("OWNER","POST",`/providers/whatsapp-web/connections/${qaChannel}/commands`,{action:"connect",commandId:id,expectedVersion:1});await worker.runConnection(scope(qaOrg,qaChannel));assert.equal(starts,1);
  await request("AGENT","POST",`/providers/whatsapp-web/connections/${qaChannel}/commands`,{action:"connect",commandId:randomUUID(),expectedVersion:(await read()).version},403);
  await request("OWNER","POST",`/providers/whatsapp-web/connections/${oldChannel}/commands`,{action:"connect",commandId:randomUUID(),expectedVersion:1},404);
  await request("OWNER","POST",`/providers/whatsapp-web/connections/${qaChannel}/commands`,{action:"connect",commandId:randomUUID(),expectedVersion:(await read()).version});await worker.runConnection(scope(qaOrg,qaChannel));assert.equal(starts,2);assert.deepEqual(pairingPermissions,[true,true]);
  callbacks.connection({qr:"SYNTHETIC_QA_QR"});await source.settle(scope(qaOrg,qaChannel));await worker.runConnection(scope(qaOrg,qaChannel));assert.equal((await request("OWNER","GET",`/providers/whatsapp-web/connections/${qaChannel}/qr`)).qr,"SYNTHETIC_QA_QR");
  await vault.update(scope(qaOrg,qaChannel),r=>{r.auth=auth.replace("synthetic-old","synthetic-qa");r.keys={synthetic:"qa-only"};});callbacks.connection({state:"open"});await source.settle(scope(qaOrg,qaChannel));await worker.runConnection(scope(qaOrg,qaChannel));assert.equal((await read()).transportConfirmed,true);assert.equal(vault.get(scope(qaOrg,qaChannel))?.pairingAuthorization,undefined);timers.find(x=>!x.canceled&&x.delay===30000)!.run();await source.settle(scope(qaOrg,qaChannel));assert.equal(vault.get(scope(qaOrg,qaChannel))?.recoveryFailures,0);
  await request("AGENT","PUT",`/providers/whatsapp-web/connections/${qaChannel}/capabilities`,{outboundEnabled:true,mediaEnabled:false},403);await request("OWNER","PUT",`/providers/whatsapp-web/connections/${oldChannel}/capabilities`,{outboundEnabled:true,mediaEnabled:false},404);await request("OWNER","PUT",`/providers/whatsapp-web/connections/${qaChannel}/capabilities`,{outboundEnabled:true,mediaEnabled:false});
  const opened=await request("OWNER","POST","/conversations/external",{channelId:qaChannel,phone:"+15550001111"});assert.equal(sends,0);assert.equal(resolves,1);assert.equal(opened.mediaEnabled,false);const messageId=randomUUID(),body={body:"Synthetic QA text",clientMessageId:messageId};const sent=await request("OWNER","POST",`/conversations/${opened.id}/messages`,body);assert.equal(sent.status,"PENDING");await worker.runConnection(scope(qaOrg,qaChannel));await worker.runConnection(scope(qaOrg,qaChannel));await request("OWNER","POST",`/conversations/${opened.id}/messages`,body);await worker.runConnection(scope(qaOrg,qaChannel));assert.equal(sends,1);const stored=await db.message.findUniqueOrThrow({where:{id:sent.id}});assert.equal(stored.status,"READ");assert.equal(stored.senderUserId,owner.id);assert.equal(stored.organizationId,qaOrg);
  assert.ok((await request("OWNER","GET","/realtime/events")).events.some((e:{type:string})=>e.type==="message.created"));
  callbacks.text({id:"SYNTHETIC_QA_REPLY",chatId:"15550001111@s.whatsapp.net",body:"Synthetic reply",fromMe:false,timestamp:Date.now()});await source.settle(scope(qaOrg,qaChannel));await worker.runConnection(scope(qaOrg,qaChannel));assert.equal(await db.message.count({where:{organizationId:oldOrg}}),1);assert.equal(JSON.stringify(vault.get(scope(oldOrg,oldChannel))),before);
  await request("OWNER","POST","/session/organization",{organizationId:oldOrg});await request("OWNER","GET","/conversations/"+opened.id,undefined,404);assert.ok(!(await request("OWNER","GET","/contacts")).items.some((c:{id:string})=>c.id===opened.contactId));await request("OWNER","POST","/session/organization",{organizationId:qaOrg});
  await source.shutdown();const restored=new Vault(vault.directory,key);await restored.initialize();assert.equal(restored.get(scope(qaOrg,qaChannel))?.auth,auth.replace("synthetic-old","synthetic-qa"));assert.deepEqual(restored.get(scope(oldOrg,oldChannel))?.keys,{synthetic:"retained"});
  let recovered=0;const resumed=new Sessions(restored,new EventJournal(restored),async (s,_callbacks,authorization)=>{assert.equal(s.connectionId,qaChannel);assert.equal(authorization?.allowPairing,false);recovered++;return {close(){},logout:async()=>undefined};},true,()=>()=>{},Date.now,()=>{}, {enabled:false,historyEnabled:false,linkedRecoveryOnly:true});
  try{await resumed.recover();assert.equal(recovered,1);assert.equal(restored.get(scope(qaOrg,qaChannel))?.auth,auth.replace("synthetic-old","synthetic-qa"));assert.throws(()=>resumed.qr(scope(qaOrg,qaChannel)),/QR_NOT_AVAILABLE/);assert.equal(restored.get(scope(oldOrg,oldChannel))?.attempts,10);}finally{await resumed.shutdown();}
 }finally{
  await app.close();await source.shutdown();await http.close();
  const where={organizationId:{in:orgs}};
  await db.providerInbox.deleteMany({where});await db.providerCommand.deleteMany({where});await db.providerConnection.deleteMany({where});await db.internalNote.deleteMany({where});await db.conversationTag.deleteMany({where});await db.conversationAssignmentHistory.deleteMany({where});await db.message.deleteMany({where});await db.contactIdentity.deleteMany({where});await db.conversation.deleteMany({where});await db.contact.deleteMany({where});await db.channel.deleteMany({where});await db.realtimeEvent.deleteMany({where});await db.membershipPermissionOverride.deleteMany({where});await db.membership.deleteMany({where});await db.auditEvent.deleteMany({where});await db.session.deleteMany({where:{id:{in:sessionIds}}});await db.organization.deleteMany({where:{id:{in:orgs}}});await db.user.deleteMany({where:{id:{in:users}}});redis.disconnect();await db.$disconnect();await rm(directory,{recursive:true,force:true});
 }
});
