// LOCAL NETWORK DOUBLE ONLY. Snapshot format comes from frozen API contract,
// never imported by product code. Selection here is test setup, not server SQL proof.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const schema=JSON.parse(readFileSync(new URL('../../../../contracts/auth-membership.v0.3.json',import.meta.url),'utf8')).schemaDefinitions.PolicySnapshot.properties;
const kinds=['TERMS','PRIVACY_CONSENT','PRIVACY_POLICY','MARKETING','OPERATIONS'];
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
export function snapshotFixture(documents,state={}) {
  const rows=documents.map(d=>{
    const selected=state.currentDocuments?.filter(x=>x.kind===d.kind);
    const current=selected===undefined?documents.find(x=>x.kind===d.kind&&x.canConsent):selected.length===1?selected[0]:null;
    const isCurrent=!!current&&current.version===d.version&&d.canConsent===true;
    const display=documents.find(x=>x.kind===d.kind&&(x.version===current?.version))??documents.find(x=>x.kind===d.kind);
    return {id:d.id??'local-opaque/'+d.kind+'/'+d.version,...d,approvedAt:d.approvedAt??(d.canConsent?'2026-01-01T00:00:00.000Z':null),createdAt:d.createdAt??'2026-01-01T00:00:00.000Z',isCurrent:d.isCurrent??isCurrent,isDisplay:d.isDisplay??(d===display)};
  });
  const currentDocuments=kinds.map(kind=>{
    const selected=state.currentDocuments?.filter(x=>x.kind===kind);
    const d=rows.find(x=>x.kind===kind&&x.isCurrent);
    const ref=d?Object.fromEntries(['id','kind','version','bodySha256','status','canConsent'].map(k=>[k,d[k]])):null;
    if(ref&&selected?.length===1){ref.status=selected[0].status;ref.canConsent=selected[0].canConsent;}
    return {kind,currentDocument:ref};
  });
  // Old exact-selector duplicate fixtures intentionally become invalid metadata.
  for(const kind of kinds)if(state.currentDocuments?.filter(x=>x.kind===kind).length>1)currentDocuments.push(currentDocuments.find(x=>x.kind===kind));
  const requirements=structuredClone(schema.requirements.const),constraints=structuredClone(schema.constraints.const);
  const snapshot={schemaVersion:'policy-v0.3',policyRevision:'ps3-'+sha(JSON.stringify({rows,currentDocuments,requirements,constraints})),serverTime:state.serverTime??'2026-10-31T00:00:00.000Z',timeAuthority:'POSTGRES_TRANSACTION_NOW',cache:structuredClone(schema.cache.const),requirements,constraints,currentDocuments,missingReadyKinds:requirements.requiredReadyKindsForGrant.filter(k=>!currentDocuments.find(x=>x.kind===k)?.currentDocument),documents:rows,limitations:structuredClone(schema.limitations.const)};
  return state.snapshotOverride===undefined?snapshot:typeof state.snapshotOverride==='function'?state.snapshotOverride(snapshot):state.snapshotOverride;
}
