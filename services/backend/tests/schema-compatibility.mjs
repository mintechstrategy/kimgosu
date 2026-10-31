// Real PostgreSQL release test, not a production migration command.
// Requires a fresh named local CI database; refuses remote hosts/nonempty schema.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
const require=createRequire(process.env.KG_SCHEMA_DEPENDENCY_ROOT??new URL('../package.json',import.meta.url));
const {Pool}=require('pg');
const database=process.env.KG_SCHEMA_TEST_DATABASE;
assert.equal(database,'kg_release_ci');
const host=process.env.KG_SCHEMA_TEST_HOST;
assert(host==='127.0.0.1'||host?.startsWith('/Users/mintech-mac/.hermes/profiles/project-lead/cache/scratch/kgpg'));
assert.equal(process.version,'v24.22.2');
const connection={host,port:Number(process.env.KG_SCHEMA_TEST_PORT??5432),database,user:process.env.KG_SCHEMA_TEST_USER??'postgres',ssl:false,connectionTimeoutMillis:5000,statement_timeout:20000,max:2};
const pool=new Pool(connection);const runtime=new Pool({...connection,user:'kg_dev_runtime'});
const migrations=process.env.KG_SCHEMA_MIGRATIONS_DIR??fileURLToPath(new URL('../migrations/',import.meta.url));
const hash=s=>createHash('sha256').update(s).digest('hex');
let checks=0;
const denied=async(sql,values=[])=>{let e;try{await runtime.query(sql,values);}catch(err){e=err;}assert.equal(e?.code,'23514');checks++;};
try{
 assert.equal((await pool.query('SELECT current_database() db')).rows[0].db,database);
 assert.equal((await pool.query("SELECT to_regnamespace('kg_membership') n")).rows[0].n,null);
 if((await pool.query("SELECT 1 FROM pg_roles WHERE rolname='kg_dev_runtime'")).rowCount===0)await pool.query('CREATE ROLE kg_dev_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE');
 for(const name of ['001_membership.sql','002_auth_lifecycle.sql','003_explicit_social_link.sql'])await pool.query(readFileSync(migrations+'/'+name,'utf8'));
 const principal=randomUUID(),member=randomUUID();
 await pool.query('INSERT INTO kg_membership.principals(id) VALUES($1)',[principal]);
 await pool.query("INSERT INTO kg_membership.members(id,principal_id,name,email,nickname,status,phone_digest) VALUES($1,$2,'SYNTHETIC CI','ci@example.invalid','CI','ACTIVE',$3)",[member,principal,hash('synthetic-ci-phone')]);
 const docs=[];
 for(const [kind,status,version] of [['TERMS','READY','ready'],['OPERATIONS','DRAFT','plain'],['MARKETING','DRAFT','referenced']]){
  const ready=status==='READY';
  docs.push((await pool.query("INSERT INTO kg_membership.policy_documents(kind,status,version,title,body,body_sha256,operator_name,effective_at,approved_at) VALUES($1,$2,$3,'SYNTHETIC CI','ci body',$4,CASE WHEN $5 THEN 'CI' END,CASE WHEN $5 THEN now() END,CASE WHEN $5 THEN now() END) RETURNING *",[kind,status,version,hash('ci body'),ready])).rows[0]);
 }
 await pool.query("INSERT INTO kg_membership.consent_events(member_id,document_id,action,request_id) VALUES($1,$2,'WITHDRAWN',$3)",[member,docs[2].id,randomUUID()]);
 const before=(await pool.query('SELECT to_jsonb(d) original FROM kg_membership.policy_documents d ORDER BY id')).rows;
 const events=(await pool.query('SELECT * FROM kg_membership.consent_events ORDER BY id')).rows;
 await pool.query(readFileSync(migrations+'/004_policy_content_integrity.sql','utf8'));
 assert.deepEqual((await pool.query("SELECT to_jsonb(d)-'content_sealed' original FROM kg_membership.policy_documents d ORDER BY id")).rows,before);checks++;
 assert.deepEqual((await pool.query('SELECT * FROM kg_membership.consent_events ORDER BY id')).rows,events);checks++;
 assert.deepEqual((await pool.query('SELECT content_sealed FROM kg_membership.policy_documents ORDER BY id')).rows.map(x=>x.content_sealed),[true,false,true]);checks++;
 await denied('UPDATE kg_membership.policy_documents SET title=$2 WHERE id=$1',[docs[0].id,'forbidden']);
 await denied('UPDATE kg_membership.consent_events SET action=action');
 await denied("INSERT INTO kg_membership.consent_events(member_id,document_id,action,request_id) VALUES($1,$2,'WITHDRAWN',$3)",[member,docs[1].id,randomUUID()]);
 await runtime.query("UPDATE kg_membership.policy_documents SET title='editable CI' WHERE id=$1",[docs[1].id]);checks++;
 const reader=await runtime.connect();try{await reader.query('BEGIN');await reader.query('LOCK TABLE kg_membership.policy_documents IN SHARE MODE');await reader.query('ROLLBACK');checks++;}finally{await reader.query('ROLLBACK');reader.release();}
 assert.equal((await pool.query("SELECT count(*)::int n FROM pg_trigger WHERE tgrelid IN ('kg_membership.policy_documents'::regclass,'kg_membership.consent_events'::regclass) AND tgname IN ('policy_content_integrity_guard','consent_event_integrity_guard') AND tgenabled='O'")).rows[0].n,2);checks++;
 console.log(JSON.stringify({status:'PASS',checks,node:process.version,serverVersion:(await pool.query('SHOW server_version')).rows[0].server_version,scope:'fresh local CI schema migrations001-004, original rows/cutoff preserved, ordinary DML denial and editable draft positive; not remote migration or full consent flow'}));
}finally{await runtime.end();await pool.end();}
