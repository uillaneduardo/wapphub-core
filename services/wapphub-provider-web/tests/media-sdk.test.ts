import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createCipheriv } from "node:crypto";
import { downloadContentFromMessage, getMediaKeys, getHttpStream } from "baileys";
test("pinned SDK preserves signed path, AbortSignal and redirect policy while decrypting valid media", async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const key = Buffer.alloc(32,7), bytes = Buffer.from("OggSsynthetic received media"), keys = await getMediaKeys(key,"audio"), cipher = createCipheriv("aes-256-cbc",keys.cipherKey,keys.iv), encrypted = Buffer.concat([cipher.update(bytes),cipher.final(),Buffer.alloc(10)]), controller = new AbortController();
  globalThis.fetch = async (url,options) => {
    assert.equal(String(url),"https://mmg.whatsapp.net/synthetic.enc?auth=SYNTHETIC_ONLY"); assert.equal(options?.signal,controller.signal); assert.equal(options?.redirect,"error"); return new Response(encrypted);
  };
  const stream = await downloadContentFromMessage({ directPath: "/synthetic.enc?auth=SYNTHETIC_ONLY",mediaKey:key },"audio",{host:"mmg.whatsapp.net",options:{signal:controller.signal,redirect:"error"}});
  const chunks = [];for await(const chunk of stream)chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),bytes);
});
test("SDK rejects a real HTTP redirect and aborts an unfinished fetch without following another origin", async t => {
  let targetRequests=0;
  const target=createServer((_req,res)=>{targetRequests++;res.end("forbidden target");});target.listen(0,"127.0.0.1");await once(target,"listening");
  const address=target.address();assert.ok(address&&typeof address!=="string");
  let arrived!:()=>void;const started=new Promise<void>(resolve=>{arrived=resolve;});
  const source=createServer((req,res)=>{if(req.url==="/redirect"){res.writeHead(302,{location:`http://127.0.0.1:${address.port}/target`});res.end();}else{arrived();}});source.listen(0,"127.0.0.1");await once(source,"listening");const port=source.address();assert.ok(port&&typeof port!=="string");
  t.after(async()=>{source.closeAllConnections();target.closeAllConnections();await Promise.all([new Promise<void>(resolve=>source.close(()=>resolve())),new Promise<void>(resolve=>target.close(()=>resolve()))]);});
  await assert.rejects(getHttpStream(`http://127.0.0.1:${port.port}/redirect`,{redirect:"error"}));assert.equal(targetRequests,0);
  const abort=new AbortController(), pending=getHttpStream(`http://127.0.0.1:${port.port}/blocked`,{redirect:"error",signal:abort.signal});const rejected=assert.rejects(pending);await started;abort.abort();await rejected;
});
test("SDK stream destruction cancels the fetched body and forwards remote stream errors",async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});const key=Buffer.alloc(32,7);
  for(const fail of [false,true]){
    let cancel=false,source!:ReadableStreamDefaultController<Uint8Array>;
    globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){source=controller;},cancel(){cancel=true;}}));
    const stream=await downloadContentFromMessage({directPath:"/synthetic",mediaKey:key},"image",{options:{redirect:"error"}});
    if(fail){const errored=assert.rejects(async()=>{for await(const chunk of stream)void chunk;});source.error(Error("synthetic remote failure"));await errored;}
    else{const closed=once(stream,"close");stream.destroy();await closed;await new Promise(resolve=>setImmediate(resolve));assert.equal(cancel,true);}
  }
});
