export async function up(knex) {
  const exists = await knex.schema.hasTable('sessions');
  if (!exists) {
    await knex.schema.createTable('sessions', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE').index();
      table.string('token_hash').notNullable().unique();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('expires_at').notNullable().index();
    });

    await knex.raw(`
      insert into sessions (user_id, token_hash, expires_at)
      select id, encode(sha256(convert_to("authorization", 'UTF8')), 'hex'), now() + interval '7 days'
      from users
      where "authorization" is not null
    `);
  }

  await knex.raw('alter table users alter column "authorization" drop not null');
  await knex('users').whereNotNull('authorization').update({ authorization: null });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('sessions');
}
