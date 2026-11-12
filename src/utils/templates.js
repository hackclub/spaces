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

const RELEASE_CACHE_MS = 60 * 60 * 1000;
const RELEASE_RETRY_MS = 5 * 60 * 1000;
const releaseCache = new Map();

export const latestGithubRelease = async (repo) => {
  const cached = releaseCache.get(repo);
  if (cached && Date.now() < cached.until) return cached.version;

  try {
    const response = await fetch(`https://github.com/${repo}/releases/latest`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    const tag = response.headers.get('location')?.match(/\/releases\/tag\/([^/?#]+)$/)?.[1];
    if (!tag) throw new Error(`no release tag in the answer (${response.status})`);
    const version = decodeURIComponent(tag).replace(/^v/, '');
    releaseCache.set(repo, { version, until: Date.now() + RELEASE_CACHE_MS });
    return version;
  } catch (err) {
    console.error(`Failed to look up the latest ${repo} release:`, err.message);
    releaseCache.set(repo, { version: cached?.version ?? null, until: Date.now() + RELEASE_RETRY_MS });
    return cached?.version ?? null;
  }
};

const releaseVersions = async (configs) => {
  const entries = await Promise.all(Object.entries(configs)
    .map(([type, config]) => [type, config.versions?.[0]?.githubRelease])
    .filter(([, repo]) => repo)
    .map(async ([type, repo]) => [type, await latestGithubRelease(repo)]));
  return entries.filter(([, version]) => version);
};

export const appVersion = (version) => (version ? String(version).replace(/-ls\d+$/, '') : null);

export const templateVersions = async (configs) => {
  const [templates, releases] = await Promise.all([pg('space_templates'), releaseVersions(configs)]);
  return new Map([
    ...templates
      .filter((template) => configs[template.type] && isCurrent(template, configs[template.type]) && template.version)
      .map((template) => [template.type, appVersion(template.version)]),
    ...releases
  ]);
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
  const [templates, releases] = await Promise.all([pg('space_templates'), releaseVersions(configs)]);
  const byType = Object.fromEntries(templates.map((template) => [template.type, template]));
  const releaseByType = new Map(releases);

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
        current: version.current
          ?? (version.githubRelease ? releaseByType.get(type) ?? null : null)
          ?? (version.fromTemplate && current ? template.version : null),
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

const removeUnusedTemplates = async (configs, templates) => {
  for (const template of templates.filter((item) => configs[item.type]?.kind !== 'gui')) {
    try {
      await deleteSnapshot(template.snapshot_id);
      await pg('space_templates').where('type', template.type).delete();
    } catch (err) {
      console.error(`Failed to remove the unused ${template.type} template:`, err.message);
    }
  }
};

export const rebuildTemplates = async (configs, { force = false, only = null } = {}) => {
  const templates = await pg('space_templates');
  if (!only) await removeUnusedTemplates(configs, templates);
  const byType = Object.fromEntries(templates.map((template) => [template.type, template]));
  const due = guiTypes(configs)
    .filter(([type]) => !only || type === only)
    .filter(([type, config]) => force || !isFresh(byType[type], config));

  const results = await Promise.allSettled(due.map(([type, config]) => buildTemplate(type, config)));

  return due.map(([type], index) => (results[index].status === 'fulfilled'
    ? { ok: true, ...results[index].value }
    : { ok: false, type, error: results[index].reason?.message || 'Failed to build the template' }));
};
