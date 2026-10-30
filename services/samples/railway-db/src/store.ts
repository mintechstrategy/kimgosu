import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';

const exec = promisify(execFile);
export const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const uuid = new RegExp(UUID);
export type RecordValue = { id: string; message: string; version: number };
export interface Store {
  create(id: string, message: string): Promise<RecordValue | null>;
  read(id: string): Promise<RecordValue | null>;
}

// Operator-only diagnostic transport. Not a production application DB adapter.
// No credential material is read or copied; the existing SSH identity is used by CLI.
export class RailwayStore implements Store {
  readonly namespace: string;
  readonly owner: string;
  constructor(runId: string, owner: string) {
    if (!uuid.test(runId) || !uuid.test(owner)) throw new Error('invalid run identity');
    this.namespace = `kg-devdb-129-${runId}`;
    this.owner = owner;
  }
  async sql(statement: string): Promise<string> {
    const { stdout } = await exec('railway', [
      'ssh', '-p', '95b52b2c-e1c0-45da-909b-d7989ce08a90',
      '-e', 'a1b5a11e-88a1-417e-84bc-2bbb2ba0fc18',
      '-s', 'eb0fec52-b955-4671-8f59-67a46fc1479d',
      '-i', `${homedir()}/.hermes/profiles/project-lead/private-credentials/kimgosu-dev-163/identity_ed25519`,
      '--', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'railway',
      '-c', `SET ROLE kg_dev_runtime; SET statement_timeout='10s'; ${statement}`,
    ], { timeout: 45000, maxBuffer: 1024 * 1024 });
    return stdout.trim();
  }
  private filter(id?: string): string {
    if (id !== undefined && !uuid.test(id)) throw new Error('invalid record identity');
    return `namespace='${this.namespace}' AND owner_id='${this.owner}' AND kind='quote' AND synthetic=true${id ? ` AND id='${id}'` : ''}`;
  }
  async create(id: string, message: string): Promise<RecordValue | null> {
    this.filter(id);
    const hex = Buffer.from(JSON.stringify({ diagnostic: 'KG-ENV-SAMPLE-01', message })).toString('hex');
    const result = await this.sql(`INSERT INTO kg_dev_slice.registrations(namespace,owner_id,kind,id,input)
      VALUES ('${this.namespace}','${this.owner}','quote','${id}',convert_from(decode('${hex}','hex'),'UTF8')::json)
      ON CONFLICT DO NOTHING RETURNING json_build_object('id',id,'message',input->>'message','version',version)::text;`);
    return result ? JSON.parse(result) : null;
  }
  async read(id: string): Promise<RecordValue | null> {
    const result = await this.sql(`SELECT json_build_object('id',id,'message',input->>'message','version',version)::text
      FROM kg_dev_slice.registrations WHERE ${this.filter(id)};`);
    return result ? JSON.parse(result) : null;
  }
  async inspect(id: string): Promise<unknown> {
    const result = await this.sql(`SELECT json_build_object('database',current_database(),'role',current_user,
      'namespace',namespace,'ownerId',owner_id,'id',id,'input',input,'synthetic',synthetic,'version',version)::text
      FROM kg_dev_slice.registrations WHERE ${this.filter(id)};`);
    return result ? JSON.parse(result) : null;
  }
  async cleanup(): Promise<number> {
    await this.sql(`DELETE FROM kg_dev_slice.registrations WHERE ${this.filter()};`);
    return Number(await this.sql(`SELECT count(*) FROM kg_dev_slice.registrations WHERE ${this.filter()};`));
  }
}
