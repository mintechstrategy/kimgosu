// Contract-bound Unicode length regressions; local transport/schema only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {makeFixture} from '../browser/fixture.mjs';
import {readPolicySnapshot,consentPayload} from '../../src/policy.ts';
import {createApiClient} from '../../src/api.ts';
const require=createRequire(new URL('../../../../services/backend/package.json',import.meta.url));
const Ajv=require('ajv');
const contract=JSON.parse(readFileSync(new URL('../../../../contracts/auth-membership.v0.3.json',import.meta.url),'utf8'));
const ready=()=>{const f=makeFixture();f.documents.forEach((d:any)=>Object.assign(d,{status:'READY',canConsent:true,operator:'LOCAL',effectiveAt:'2020-01-01T00:00:00Z'}));return f;};
test('V03 opaque Unicode version uses JSONschema codepoints, not UTF16 units; 100 accepts and101 rejects',async()=>{const validate=new Ajv().compile(contract.schemaDefinitions.ConsentInputs);for(const size of [100,101]){const f=ready();f.documents[0].version='😀'.repeat(size);const s=await readPolicySnapshot(f.snapshot());const inputs=[{kind:'TERMS',version:f.documents[0].version},{kind:'PRIVACY_CONSENT',version:f.documents[1].version}];assert.equal(validate(inputs),size===100);if(size===100){const payload=consentPayload(s,{TERMS:true,PRIVACY_CONSENT:true});assert.equal(payload.consents[0].version,f.documents[0].version);assert.equal(payload.expectedPolicyRevision,s.policyRevision);}else assert.throws(()=>consentPayload(s,{TERMS:true,PRIVACY_CONSENT:true}));}});
test('V03 signup adapter name/email maxLength agrees with frozen JSONschema Unicode length',async()=>{const f=ready(),s=await readPolicySnapshot(f.snapshot());const input={registrationTicket:randomBytes(32).toString('base64url'),name:'😀'.repeat(100),email:'😀'.repeat(200)+'@x.invalid',age14Confirmed:true as const,expertRequested:false};const payload={...input,...consentPayload(s,{TERMS:true,PRIVACY_CONSENT:true})};const schema=structuredClone(contract.operations.find((x:any)=>x.id==='signup').requestSchema);schema.properties.consents=contract.schemaDefinitions.ConsentInputs;const validate=new Ajv().compile(schema);assert.equal(validate(payload),true);let posts=0;const api=createApiClient('http://127.0.0.1:4999',(async(_u:any,init:any)=>{if(init.method==='GET')return new Response(JSON.stringify({policySnapshot:s}));posts++;const sent=JSON.parse(init.body);assert.equal(sent.name,input.name);assert.equal(sent.email,input.email);assert.equal(sent.expectedPolicyRevision,s.policyRevision);return new Response(JSON.stringify({outcome:'REGISTERED',session:{accessToken:randomBytes(32).toString('base64url'),refreshToken:randomBytes(32).toString('base64url'),tokenType:'Bearer',expiresInSeconds:900}}));}) as typeof fetch);await api.signup(s,{TERMS:true,PRIVACY_CONSENT:true},input);assert.equal(posts,1);});
