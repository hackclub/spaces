export async function up(knex) {
  const hasWorkspaceDir = await knex.schema.hasColumn('spaces', 'workspace_dir');
  if (!hasWorkspaceDir) {
    await knex.schema.alterTable('spaces', (table) => {
      table.string('workspace_dir');
    });
  }
}

export async function down(knex) {
  const hasWorkspaceDir = await knex.schema.hasColumn('spaces', 'workspace_dir');
  if (hasWorkspaceDir) {
    await knex.schema.alterTable('spaces', (table) => {
      table.dropColumn('workspace_dir');
    });
  }
}
