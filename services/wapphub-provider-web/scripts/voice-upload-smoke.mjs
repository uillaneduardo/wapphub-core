import console from 'node:console';
import process from 'node:process';
import {Buffer} from 'node:buffer';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readdir,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {Vault} from '/app/dist/services/wapphub-provider-web/src/vault.js';
import {ProviderMedia} from '/app/dist/services/wapphub-provider-web/src/media.js';
import {EventJournal} from '/app/dist/services/wapphub-provider-web/src/events.js';
import {Sessions} from '/app/dist/services/wapphub-provider-web/src/sessions.js';
import {InternalAuth} from '/app/dist/services/wapphub-provider-web/src/auth.js';
import {createHttp} from '/app/dist/services/wapphub-provider-web/src/http.js';
import {signedHeaders} from '/app/dist/contracts/provider-internal.js';
if(process.env.WAPPHUB_SYNTHETIC_MEDIA!=='true')throw new Error('ISOLATED_RUNTIME_REQUIRED');
const dir=await mkdtemp('/tmp/p11-'),scope={organizationId:randomUUID(),connectionId:randomUUID()},key=randomBytes(32),internalKey=randomBytes(32);
const vault=new Vault(join(dir,'vault'),key);await vault.initialize();
const journal=new EventJournal(vault),diagnostics=[],media=new ProviderMedia(vault,true,(code,fields)=>diagnostics.push({code,...fields}));
const sessions=new Sessions(vault,journal,async()=>{throw new Error('NO_TRANSPORT_ALLOWED');},false);
const auth=new InternalAuth(internalKey,join(dir,'nonces'));await auth.initialize();
const app=createHttp(sessions,journal,auth,()=>{},media);const base=await app.listen({host:'127.0.0.1',port:0});
async function upload(bytes,type,mimeType,expected=200){
 const meta={mediaId:randomUUID(),type,mimeType,fileName:'mensagem-de-voz.webm',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 const path=`/internal/v1/organizations/${scope.organizationId}/connections/${scope.connectionId}/media`,start=performance.now();
 const response=await globalThis.fetch(base+path,{method:'POST',headers:{...signedHeaders(internalKey,'POST',path,meta),'content-type':'application/octet-stream','x-media-manifest':Buffer.from(JSON.stringify(meta)).toString('base64url'),'x-wapphub-request-id':'req-synthetic-p11'},body:bytes});
 const result=await response.json(); if(response.status>=400) console.log(JSON.stringify({stages:diagnostics.slice(-6)})); console.log(JSON.stringify({type,bytes:bytes.length,http:response.status,code:result.error?.code,ms:Math.round(performance.now()-start)}));
 if(process.env.WAPPHUB_EXPECT_BASELINE==='true'){assert.equal(response.status,503);assert.equal(result.error.code,'REQUEST_FAILED');return;}
 assert.equal(response.status,expected,JSON.stringify(result));
 if(expected===200){assert.equal(result.mimeType,'audio/ogg');assert.equal(result.fileName,'mensagem-de-voz.ogg');const item=vault.get(scope).media.find(x=>x.id===meta.mediaId);assert.ok(item.seconds>0&&item.seconds<=600);const read=await media.read(scope,meta.mediaId);const chunks=[];for await(const chunk of read.stream)chunks.push(chunk);const bytes=Buffer.concat(chunks);assert.equal(bytes.subarray(0,4).toString(),'OggS');assert.equal(bytes.length,result.size);assert.equal(createHash('sha256').update(bytes).digest('hex'),result.sha256);}
 else assert.ok(!vault.get(scope).media?.some(x=>x.id===meta.mediaId));
}
function webm(seconds){const bytes=execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i',`sine=frequency=440:duration=${seconds}`,'-threads','1','-c:a','libopus','-b:a','64000','-f','webm','pipe:1'],{maxBuffer:16*1024*1024,timeout:30000});const index=bytes.indexOf(Buffer.from('DURATION'));if(index>=0)bytes.write('XURATION',index);return bytes;}
try{
 await sessions.create(scope);
 if(process.env.WAPPHUB_EXPECT_BASELINE==='true'){await upload(webm(60),'VOICE','audio/webm');}
 else{
  for(const seconds of [0.04,5,60])for(const type of ['VOICE','AUDIO'])await upload(webm(seconds),type,'audio/webm');
  await upload(webm(601),'VOICE','audio/webm',415);
  const failBin=join(dir,'failed-codec');await mkdir(failBin);await symlink('/usr/bin/false',join(failBin,'ffmpeg'));
  const shortInput=webm(0.04),pathBefore=process.env.PATH;process.env.PATH=failBin+':'+pathBefore;
  try{await upload(shortInput,'VOICE','audio/webm',415);}finally{process.env.PATH=pathBefore;}
  const cancellation=new globalThis.AbortController(),cancelId=randomUUID();
  const cancelledMedia=new ProviderMedia(vault,true,(_code,fields)=>{if(fields?.stage==='CONVERT')cancellation.abort();});
  await assert.rejects(cancelledMedia.upload(scope,{mediaId:cancelId,type:'VOICE',mimeType:'audio/webm',fileName:'cancel.webm',size:shortInput.length,sha256:createHash('sha256').update(shortInput).digest('hex')},(async function*(){yield shortInput;})(),cancellation.signal),{code:'MEDIA_TRANSFER_CANCELLED',statusCode:499});
  assert.ok(!vault.get(scope).media?.some(item=>item.id===cancelId));
  const corrupt=Buffer.concat([Buffer.from('1a45dfa3','hex'),Buffer.alloc(100)]);await upload(corrupt,'VOICE','audio/webm',415);
  assert.ok(diagnostics.some(row=>row.stage==='CONVERT'));assert.ok(diagnostics.some(row=>row.stage==='DURATION'));assert.ok(diagnostics.some(row=>row.code==='MEDIA_UPLOAD_READY'&&row.requestId==='req-synthetic-p11'));
  assert.ok(!(await readdir(join(vault.directory,'files'))).some(name=>name.endsWith('.part')));
  console.log(JSON.stringify({check:'voice-upload-streaming-webm',noContainerDuration:true,encryptedOggVerified:true,metadataLimits:true,realSends:0,network:'none',rssMiB:Math.round(process.memoryUsage().rss/1024/1024)}));
 }
}finally{await sessions.shutdown();await app.close();await rm(dir,{recursive:true,force:true});}
