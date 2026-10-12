import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {makeEventBuffer} from 'baileys';
import pino from 'pino';
import {fixture} from './helpers.js';
import {Sessions} from '../src/sessions.js';
import {baileysFactory,pairingWebVersion} from '../src/baileys.js';

async function pairing(t: Parameters<typeof fixture>[0]) {
 const f=await fixture(t),events: ReturnType<typeof makeEventBuffer>[]=[];const permissions:boolean[]=[];
 const options={enabled:false,historyEnabled:false,linkedRecoveryOnly:true};
 const factory=baileysFactory(f.vault, config=>{assert.equal(config.auth?.creds.me,undefined);const ev=makeEventBuffer(pino({level:'silent'}));events.push(ev);return{ev,end:async()=>undefined,logout:async()=>assert.fail('no remote logout')};},options);
 const sessions=new Sessions(f.vault,f.journal,(scope,cb,auth)=>{permissions.push(auth?.allowPairing===true);return factory(scope,cb,auth);},true,(run,delay)=>{const timer={run,delay,canceled:false};f.timers.push(timer);return()=>{timer.canceled=true};},f.now,code=>f.logs.push(code),options);
 t.after(()=>sessions.shutdown());await sessions.create(f.scope);return{...f,sessions,events,permissions};
}
const close=(code:number,message='Connection Terminated')=>({connection:'close' as const,lastDisconnect:{date:new Date(),error:Object.assign(new Error(message),{output:{statusCode:code}})}});

test('first pairing uses scoped permission, CONNECTING, and no linked recovery budget even after legacy attempts5',async t=>{
 const f=await pairing(t);await f.vault.update(f.scope,r=>{r.state='FAILED';r.errorCode='RECONNECT_LIMIT';r.attempts=5;r.recoveryFailures=5;r.desired=true;});
 const id=randomUUID();await f.sessions.command(f.scope,'connect',id,1);await f.sessions.command(f.scope,'connect',id,1);
 assert.deepEqual(f.permissions,[true]);assert.equal(f.sessions.view(f.scope).state,'CONNECTING');assert.equal(f.sessions.view(f.scope).pairingPhase,'GENERATING_QR');assert.equal(f.vault.get(f.scope)?.attempts,6);assert.equal(f.vault.get(f.scope)?.recoveryFailures,5);
 assert.equal(f.vault.get(f.scope)?.pairingAuthorization?.commandId,id);assert.equal(f.sessions.view(f.scope).sync.lifecycle.linked,false);assert.throws(()=>f.sessions.qr(f.scope),/QR_NOT_AVAILABLE/);
 await assert.rejects(f.sessions.command(f.other,'connect',randomUUID(),1),/SESSION_NOT_FOUND/);assert.deepEqual(f.permissions,[true]);
});
test('no QR reaches a distinct deadline, ignores late QR, and needs another explicit fenced authorization',async t=>{
 const f=await pairing(t),id=randomUUID();await f.sessions.command(f.scope,'connect',id,1);
 f.advance(30000);f.timers.find(x=>!x.canceled&&x.delay===30000)!.run();await f.sessions.settle(f.scope);
 assert.equal(f.sessions.view(f.scope).errorCode,'QR_GENERATION_TIMEOUT');assert.equal(f.vault.get(f.scope)?.desired,false);assert.equal(f.vault.get(f.scope)?.pairingAuthorization,undefined);assert.equal(f.sessions.metrics().active,0);assert.equal(f.timers.filter(x=>!x.canceled).length,0);
 const creds=f.vault.get(f.scope)?.auth;f.events[0]!.emit('connection.update',{qr:'SYNTHETIC_LATE_QR'});await f.sessions.settle(f.scope);assert.equal(f.sessions.view(f.scope).qrRevision,0);
 await f.sessions.command(f.scope,'connect',id,1);await f.sessions.recover();assert.equal(f.events.length,1);
 await assert.rejects(f.sessions.command(f.scope,'connect',randomUUID(),1),/STALE_CONTROL_COMMAND/);
 await f.sessions.command(f.scope,'connect',randomUUID(),2);assert.equal(f.events.length,2);assert.equal(f.vault.get(f.scope)?.auth,creds);assert.equal(f.vault.get(f.scope)?.attempts,2);
 f.events[1]!.emit('connection.update',{qr:'SYNTHETIC_QR'});await f.sessions.settle(f.scope);assert.equal(f.sessions.view(f.scope).state,'QR_REQUIRED');assert.equal(f.sessions.qr(f.scope).revision,1);
 f.advance(20001);assert.throws(()=>f.sessions.qr(f.scope),/QR_NOT_AVAILABLE/);
 await f.sessions.command(f.scope,'refresh',randomUUID(),3);assert.equal(f.events.length,3);assert.equal(f.sessions.view(f.scope).state,'CONNECTING');
});
for(const code of [428,503,401])test(`unlinked close${code} before QR is terminal with no recovery loop or revocation`,async t=>{
 const f=await pairing(t);await f.sessions.command(f.scope,'connect',randomUUID(),1);const before=f.vault.get(f.scope)?.auth;
 f.events[0]!.emit('connection.update',close(code));await f.sessions.settle(f.scope);
 assert.equal(f.sessions.view(f.scope).state,'FAILED');assert.equal(f.sessions.view(f.scope).errorCode,code===401?'PAIRING_REJECTED':'PAIRING_TRANSPORT_CLOSED');assert.equal(f.vault.get(f.scope)?.invalidated,undefined);assert.equal(f.vault.get(f.scope)?.recoveryFailures,undefined);assert.equal(f.vault.get(f.scope)?.desired,false);assert.equal(f.vault.get(f.scope)?.auth,before);assert.equal(f.vault.get(f.scope)?.lastDisconnect?.code,code);assert.equal(f.vault.get(f.scope)?.lastDisconnect?.cause,'WS_CLOSED');
 assert.equal(f.timers.filter(x=>!x.canceled).length,0);await f.sessions.recover();assert.equal(f.events.length,1);assert.equal(f.sessions.view(f.scope).sync.lifecycle.pairingEligible,true);
});
test('QR scan persists identity and permits exactly one515 completion without another QR or resetting failures',async t=>{
 const f=await fixture(t),events: ReturnType<typeof makeEventBuffer>[]=[];const allowed:boolean[]=[];const opts={enabled:false,historyEnabled:false,linkedRecoveryOnly:true};
 const sdk=baileysFactory(f.vault,config=>{assert.equal(!!config.auth?.creds.me?.id,events.length>0);const ev=makeEventBuffer(pino({level:'silent'}));events.push(ev);return{ev,end:async()=>undefined,logout:async()=>assert.fail('no logout')};},opts);
 const sessions=new Sessions(f.vault,f.journal,(scope,cb,permission)=>{allowed.push(permission?.allowPairing===true);return sdk(scope,cb,permission);},true,(run,delay)=>{const timer={run,delay,canceled:false};f.timers.push(timer);return()=>{timer.canceled=true};},f.now,()=>undefined,opts);t.after(()=>sessions.shutdown());
 await sessions.create(f.scope);await f.vault.update(f.scope,r=>{r.attempts=5;r.recoveryFailures=5});await sessions.command(f.scope,'connect',randomUUID(),1);
 events[0]!.emit('connection.update',{qr:'SYNTHETIC_SCAN_QR'});await sessions.settle(f.scope);events[0]!.emit('creds.update',{me:{id:'synthetic@lid'}});await f.vault.flush();
 events[0]!.emit('connection.update',{isNewLogin:true});await sessions.settle(f.scope);assert.equal(sessions.view(f.scope).pairingPhase,'AUTHENTICATING');assert.throws(()=>sessions.qr(f.scope),/QR_NOT_AVAILABLE/);
 events[0]!.emit('connection.update',close(515));await sessions.settle(f.scope);f.advance(1000);f.timers.find(x=>!x.canceled&&x.delay===1000)!.run();await sessions.settle(f.scope);
 assert.deepEqual(allowed,[true,false]);assert.equal(sessions.view(f.scope).state,'CONNECTING');assert.equal(sessions.view(f.scope).pairingPhase,'AUTHENTICATING');assert.equal(f.vault.get(f.scope)?.recoveryFailures,5);assert.equal(f.vault.get(f.scope)?.attempts,7);assert.equal(f.vault.get(f.scope)?.pairingAuthorization,undefined);
 events[1]!.emit('connection.update',{connection:'open'});await sessions.settle(f.scope);assert.equal(sessions.view(f.scope).state,'CONNECTED');assert.equal(sessions.view(f.scope).sync.activeTransport,true);assert.equal(sessions.view(f.scope).sync.lifecycle.linked,true);
 f.advance(30000);f.timers.find(x=>!x.canceled&&x.delay===30000)!.run();await sessions.settle(f.scope);assert.equal(f.vault.get(f.scope)?.recoveryFailures,0);
});
test('failed construction and restart with exhausted unauthenticated authorization never open another socket',async t=>{
 const f=await fixture(t),sessions=new Sessions(f.vault,f.journal,async()=>{throw Object.assign(new Error('SENSITIVE_DATA'),{code:'ECONNREFUSED'})},true,undefined,f.now,code=>f.logs.push(code),{enabled:false,historyEnabled:false,linkedRecoveryOnly:true});t.after(()=>sessions.shutdown());
 await sessions.create(f.scope);await sessions.command(f.scope,'connect',randomUUID(),1);assert.equal(sessions.view(f.scope).errorCode,'PAIRING_START_FAILED');assert.equal(f.vault.get(f.scope)?.desired,false);assert.ok(!f.logs.some(x=>x.includes('SENSITIVE_DATA')));
 await f.vault.update(f.scope,r=>{r.state='FAILED';r.errorCode='RECONNECT_LIMIT';r.attempts=5;r.recoveryFailures=5;r.desired=true;r.pairingAuthorization={commandId:randomUUID(),expiresAt:f.now()-1}});
 await sessions.recover();assert.equal(f.vault.get(f.scope)?.desired,false);assert.equal(f.vault.get(f.scope)?.attempts,5);assert.equal(f.vault.get(f.scope)?.recoveryFailures,5);assert.equal(sessions.view(f.scope).errorCode,'RECONNECT_LIMIT');assert.equal(f.stats().starts,0);
});
test('a second515 during completion fails once and retains the newly authenticated credentials',async t=>{
 const f=await fixture(t);await f.sessions.create(f.scope);await f.sessions.command(f.scope,'connect',randomUUID(),1);
 const auth=JSON.stringify({me:{id:'synthetic@lid'},noiseKey:{private:'synthetic',public:'synthetic'},signedIdentityKey:{private:'synthetic',public:'synthetic'}});
 await f.vault.update(f.scope,r=>{r.auth=auth});f.callbacks[0]!.connection({state:'close',code:515});await f.sessions.settle(f.scope);
 f.timers.find(x=>!x.canceled&&x.delay===1000)!.run();await f.sessions.settle(f.scope);assert.equal(f.stats().starts,2);
 f.callbacks[1]!.connection({state:'close',code:515});await f.sessions.settle(f.scope);assert.equal(f.sessions.view(f.scope).errorCode,'PAIRING_TRANSPORT_CLOSED');assert.equal(f.vault.get(f.scope)?.auth,auth);assert.equal(f.vault.get(f.scope)?.desired,false);assert.equal(f.timers.filter(x=>!x.canceled).length,0);await f.sessions.recover();assert.equal(f.stats().starts,2);
});
test('SDK disconnect diagnostics never retain unknown exception strings or QR contents',async t=>{
 const f=await pairing(t);await f.sessions.command(f.scope,'connect',randomUUID(),1);f.events[0]!.emit('connection.update',close(428,'SYNTHETIC_PERSONAL_DATA'));
 await f.sessions.settle(f.scope);assert.equal(f.vault.get(f.scope)?.lastDisconnect?.cause,'TRANSPORT_ERROR');assert.ok(!JSON.stringify(f.vault.get(f.scope)).includes('SYNTHETIC_PERSONAL_DATA'));assert.ok(!f.logs.some(x=>x.includes('SYNTHETIC_PERSONAL_DATA')));
});
test('explicit public-version pin is validated and applied only to a scoped new pairing, never fetched on startup or used for linked recovery',async t=>{
 const f=await fixture(t);assert.equal(pairingWebVersion(''),undefined);assert.deepEqual(pairingWebVersion('2,3000,1050063423'),[2,3000,1050063423]);for(const value of ['2,3000,4294967296','2,3000,-1','2,3000,1,4','http://example.test','3,3000,123'])assert.throws(()=>pairingWebVersion(value),/PROTOCOL_VERSION_CONFIGURATION_ERROR/);
 const versions:unknown[]=[],ev=makeEventBuffer(pino({level:'silent'}));const factory=baileysFactory(f.vault,config=>{versions.push(config.version);return{ev,end:async()=>undefined,logout:async()=>undefined};},{enabled:false,historyEnabled:false,linkedRecoveryOnly:true,pairingWebVersion:pairingWebVersion('2,3000,1050063423')});
 await f.vault.update(f.scope,r=>{r.pairingAuthorization={commandId:randomUUID(),expiresAt:Date.now()+120000}});const cb={connection:()=>{},text:()=>{},receipt:()=>{},failure:()=>assert.fail('persistence failure')};const first=await factory(f.scope,cb,{allowPairing:true});assert.deepEqual(versions[0],[2,3000,1050063423]);first.close();
 await f.vault.update(f.scope,r=>{const auth=JSON.parse(r.auth!);auth.me={id:'synthetic@lid'};r.auth=JSON.stringify(auth);delete r.pairingAuthorization});const linked=await factory(f.scope,cb,{allowPairing:false});assert.equal(versions[1],undefined);linked.close();await assert.rejects(factory(f.other,cb,{allowPairing:true}),/EXISTING_AUTH_REQUIRED/);assert.equal(versions.length,2);
});
