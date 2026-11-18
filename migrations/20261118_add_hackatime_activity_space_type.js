export async function up(knex) {
  await knex.schema.alterTable('hackatime_activity', (table) => {
    table.string('space_type');
  });
  await knex.raw(`
    update hackatime_activity a
    set space_type = s.type
    from spaces s
    where s.id = a.space_id and a.space_type is null
  `);
  await knex.raw(`
    update hackatime_activity a
    set space_type = s.type
    from hackatime_legacy_machines m
    join spaces s on s.id = m.space_id
    where m.machine = a.machine and a.space_type is null
  `);
  await knex('hackatime_activity').where('source', 'hetzner').whereNull('space_type').update({ space_type: 'code-server' });
}

export async function down(knex) {
  await knex.schema.alterTable('hackatime_activity', (table) => {
    table.dropColumn('space_type');
  });
}
