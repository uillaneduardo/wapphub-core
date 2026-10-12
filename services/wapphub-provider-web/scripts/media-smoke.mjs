import console from "node:console";
import { Buffer } from "node:buffer";
import process from "node:process";
// Synthetic runtime check, run only inside the disposable --network none CI image.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { makeEventBuffer, prepareWAMessageMedia } from 'baileys';
import pino from 'pino';
import { Vault } from '/app/dist/services/wapphub-provider-web/src/vault.js';
import { EventJournal } from '/app/dist/services/wapphub-provider-web/src/events.js';
import { Sessions } from '/app/dist/services/wapphub-provider-web/src/sessions.js';
import { ProviderMedia } from '/app/dist/services/wapphub-provider-web/src/media.js';
import { baileysFactory } from '/app/dist/services/wapphub-provider-web/src/baileys.js';
import { InternalAuth } from '/app/dist/services/wapphub-provider-web/src/auth.js';
import { createHttp } from '/app/dist/services/wapphub-provider-web/src/http.js';
import { signedHeaders } from '/app/dist/contracts/provider-internal.js';
if (process.env.WAPPHUB_SYNTHETIC_MEDIA !== 'true') throw new Error('ISOLATED_RUNTIME_REQUIRED');
const directory = await mkdtemp('/tmp/wapphub-media-synthetic-'), scope = { organizationId: randomUUID(), connectionId: randomUUID() }, key = randomBytes(32), internalKey = randomBytes(32);
const vault = new Vault(join(directory,'vault'), key); await vault.initialize();
const journal = new EventJournal(vault), media = new ProviderMedia(vault, true), ev = makeEventBuffer(pino({ level:'silent' })); let sends = 0, uploads = 0;
const options = { enabled:true, historyEnabled:false, outboundEnabled:true, mediaEnabled:true, initialHistoryEnabled:false };
const sessions = new Sessions(vault,journal,baileysFactory(vault,() => ({ ev, end:async()=>{}, logout:async()=>{}, sendMessage:async(jid, content, opts) => {
  assert.equal(jid,'5581999999999@s.whatsapp.net'); assert.equal(opts.messageId.length,32);
  const message = await prepareWAMessageMedia(content,{ upload:async(path) => { const info=await stat(path); assert.ok(info.size<26*1024*1024); uploads++; return { mediaUrl:'https://mmg.whatsapp.net/synthetic-not-used',directPath:'/synthetic-not-used' }; }, logger:pino({level:'silent'}) });
  assert.ok(message.imageMessage || message.audioMessage || message.videoMessage); sends++; return undefined;
} }),options),true,()=>()=>{},Date.now,()=>{},options);
const auth=new InternalAuth(internalKey,join(directory,'nonces'));await auth.initialize();const app=createHttp(sessions,journal,auth,()=>{},media);
const base=await app.listen({host:'127.0.0.1',port:0}), prefix=`/internal/v1/organizations/${scope.organizationId}/connections/${scope.connectionId}`;
function generate(input,codec,format,extra=[]) { return execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i',input,'-threads','1','-t','1','-c:'+ (format==='mp4'?'v':'a'),codec,...extra,'-f',format,'pipe:1'],{maxBuffer:26*1024*1024,timeout:15000}); }
try {
  await sessions.create(scope);await sessions.command(scope,'connect',randomUUID());ev.emit('connection.update',{connection:'open'});await sessions.settle(scope);
  const fixtures=[
    {type:'IMAGE',mimeType:'image/png',bytes:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBz8AAAAASUVORK5CYII=','base64')},
    {type:'AUDIO',mimeType:'audio/mpeg',bytes:generate('sine=frequency=440:duration=1','libmp3lame','mp3')},
    {type:'VOICE',mimeType:'audio/ogg',bytes:generate('sine=frequency=440:duration=1','libopus','ogg')},
    {type:'VOICE',mimeType:'audio/webm',bytes:generate('sine=frequency=440:duration=1','libopus','webm')},
    {type:'VIDEO',mimeType:'video/mp4',bytes:generate('color=black:size=64x64:rate=5:duration=1','libx264','mp4',['-movflags','frag_keyframe+empty_moov','-pix_fmt','yuv420p'])},
  ];
  for(const fixture of fixtures){
    const meta={mediaId:randomUUID(),type:fixture.type,mimeType:fixture.mimeType,fileName:'synthetic-fixture',size:fixture.bytes.length,sha256:createHash('sha256').update(fixture.bytes).digest('hex')};
    const path=prefix+'/media',response=await globalThis.fetch(base+path,{method:'POST',headers:{...signedHeaders(internalKey,'POST',path,meta),'content-type':'application/octet-stream','x-media-manifest':Buffer.from(JSON.stringify(meta)).toString('base64url')},body:fixture.bytes});
    assert.equal(response.status,200, await response.clone().text());const saved=await response.json();assert.equal(saved.state,'READY'); if(fixture.mimeType==='audio/webm')assert.equal(saved.mimeType,'audio/ogg');
    const readPath=prefix+'/media/'+meta.mediaId, read=await globalThis.fetch(base+readPath,{headers:signedHeaders(internalKey,'GET',readPath)});assert.equal(read.status,200);const bytes=Buffer.from(await read.arrayBuffer());assert.equal(bytes.length,saved.size);assert.equal(createHash('sha256').update(bytes).digest('hex'),saved.sha256);
    const intent={commandId:randomUUID(),messageId:randomUUID(),providerMessageId:randomUUID().replaceAll('-','').toUpperCase(),destination:'5581999999999@s.whatsapp.net',body:'',media:saved,expiresAt:new Date(Date.now()+3600000).toISOString()};
    assert.equal((await sessions.send(scope,intent)).outcome,'DISPATCHED');assert.equal((await sessions.send(scope,intent)).outcome,'DISPATCHED');
  }
  assert.equal(sends,5);assert.equal(uploads,5);console.log(JSON.stringify({check:'media-runtime',types:['IMAGE','AUDIO','VOICE','VIDEO'],webmToOpus:true,authenticatedStreaming:true,encryptedCache:true,syntheticSends:sends,realSends:0,network:'none'}));
}finally{await sessions.shutdown();await app.close();await rm(directory,{recursive:true,force:true});}
