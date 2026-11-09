import pg from './db.js';
import { buildTemplateSnapshot, deleteSnapshot } from './sandboxes.js';

const TEMPLATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const templateSource = (config) => config.build?.tag ?? config.image;

const isCurrent = (template, config) => Boolean(template) && template.source === templateSource(config);

const isFresh = (template, config) => isCurrent(template, config)
  && Date.now() - new Date(template.built_at).getTime() < TEMPLATE_MAX_AGE_MS;

const guiTypes = (configs) => Object.entries(configs).filter(([, config]) => config.kind === 'gui');

export const findTemplate = async (type, config) => {
  const template = await pg('space_templates').where('type', type).first();
  return isCurrent(template, config) ? template : null;
};

export const readyTemplateTypes = async (configs) => {
  const templates = await pg('space_templates');
  return new Set(templates.filter((template) => configs[template.type] && isCurrent(template, configs[template.type])).map((template) => template.type));
};

export const appVersion = (version) => (version ? String(version).replace(/-ls\d+$/, '') : null);

export const templateVersions = async (configs) => {
  const templates = await pg('space_templates');
  return new Map(templates
    .filter((template) => configs[template.type] && isCurrent(template, configs[template.type]) && template.version)
    .map((template) => [template.type, appVersion(template.version)]));
};

export const listTemplates = async (configs) => {
  const templates = await pg('space_templates');
  const byType = Object.fromEntries(templates.map((template) => [template.type, template]));

  return guiTypes(configs).map(([type, config]) => ({
    type,
    label: config.title,
    source: templateSource(config),
    current: isCurrent(byType[type], config),
    builtAt: byType[type]?.built_at ?? null,
    sizeBytes: byType[type]?.size_bytes ? Number(byType[type].size_bytes) : null
  }));
};

export const listSpaceTypes = async (configs) => {
  const templates = await pg('space_templates');
  const byType = Object.fromEntries(templates.map((template) => [template.type, template]));

  return Object.entries(configs).map(([type, config]) => {
    const template = byType[type];
    const gui = config.kind === 'gui';
    const current = gui && isCurrent(template, config);
    return {
      type,
      title: config.title,
      category: config.category ?? 'Other',
      kind: config.kind,
      beta: Boolean(config.beta),
      source: gui ? templateSource(config) : null,
      versions: (config.versions ?? []).map((version) => ({
        name: version.name,
        current: version.current ?? (version.fromTemplate && current ? template.version : null),
        note: version.note ?? null,
        fromTemplate: Boolean(version.fromTemplate),
        latestUrl: version.latestUrl
      })),
      template: gui
        ? {
          current,
          builtAt: template?.built_at ?? null,
          sizeBytes: template?.size_bytes ? Number(template.size_bytes) : null,
          version: template?.version ?? null
        }
        : null
    };
  });
};

export const buildTemplate = async (type, config) => {
  const source = templateSource(config);
  const { snapshotId, sizeBytes, version } = await buildTemplateSnapshot(type, config);
  const previous = await pg('space_templates').where('type', type).first();

  await pg('space_templates')
    .insert({ type, source, snapshot_id: snapshotId, size_bytes: sizeBytes, version: version ?? null, built_at: new Date() })
    .onConflict('type')
    .merge();

  if (previous && previous.snapshot_id !== snapshotId) {
    await deleteSnapshot(previous.snapshot_id).catch((err) => {
      console.error(`Failed to delete the old ${type} template ${previous.snapshot_id}:`, err.message);
    });
  }

  return { type, source, snapshotId, sizeBytes };
};

export const rebuildTemplates = async (configs, { force = false, only = null } = {}) => {
  const templates = await pg('space_templates');
  const byType = Object.fromEntries(templates.map((template) => [template.type, template]));
  const due = guiTypes(configs)
    .filter(([type]) => !only || type === only)
    .filter(([type, config]) => force || !isFresh(byType[type], config));

  const results = await Promise.allSettled(due.map(([type, config]) => buildTemplate(type, config)));

  return due.map(([type], index) => (results[index].status === 'fulfilled'
    ? { ok: true, ...results[index].value }
    : { ok: false, type, error: results[index].reason?.message || 'Failed to build the template' }));
};
