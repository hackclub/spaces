export async function up(knex) {
  await knex('spaces').where('type', 'blender-hackatime').update({ type: 'blender' });
  await knex('space_runs').where('type', 'blender-hackatime').update({ type: 'blender' });
}

export async function down() {}
