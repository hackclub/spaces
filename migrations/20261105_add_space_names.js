export async function up(knex) {
  const hasName = await knex.schema.hasColumn('spaces', 'name');
  if (!hasName) {
    await knex.schema.alterTable('spaces', (table) => {
      table.string('name', 64);
    });
  }

  await knex.raw(`
    update spaces set name = case type
      when 'code-server' then coalesce(nullif(regexp_replace(rtrim(coalesce(workspace_dir, ''), '/'), '^.*/', ''), ''), 'workspace')
      when 'blender' then 'Blender'
      when 'kicad' then 'KiCad'
      when 'freecad' then 'FreeCAD'
      else type
    end
    where name is null
  `);
}

export async function down(knex) {
  const hasName = await knex.schema.hasColumn('spaces', 'name');
  if (hasName) {
    await knex.schema.alterTable('spaces', (table) => {
      table.dropColumn('name');
    });
  }
}
