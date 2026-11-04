import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const has = async (table, column) => (await client.query(
  `select 1 from information_schema.columns
    where table_schema='kg_membership' and table_name=$1 and column_name=$2`, [table, column],
)).rowCount > 0;

if (await has('expert_profiles', 'availability')) {
  console.log('availability: already present');
} else {
  await client.query(`alter table kg_membership.expert_profiles
    add column availability text not null default 'AVAILABLE'
    check (availability in ('AVAILABLE','PAUSED','VACATION'))`);
  console.log('availability: added');
}

if (await has('expert_services', 'image_key')) {
  console.log('image_key: already present');
} else {
  await client.query(`alter table kg_membership.expert_services
    add column image_key text check (image_key is null or length(image_key) between 1 and 300)`);
  console.log('image_key: added');
}

await client.end();
