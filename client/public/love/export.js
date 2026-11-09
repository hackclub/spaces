import { listProjects, getAllFiles } from './fs-store.js';
import { zipFiles, slugify } from './exporter.js';

const list = document.getElementById('projects');
const button = document.getElementById('download');
const status = document.getElementById('status');

function folderNames(projects) {
  const used = new Set();
  return projects.map((project) => {
    const base = slugify(project.name);
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
    used.add(name);
    return name;
  });
}

async function download(projects) {
  button.disabled = true;
  status.textContent = 'Preparing your zip...';
  try {
    const folders = folderNames(projects);
    const files = {};
    for (const [index, project] of projects.entries()) {
      for (const [path, data] of Object.entries(await getAllFiles(project.id))) {
        files[`${folders[index]}/${path}`] = data;
      }
    }
    const url = URL.createObjectURL(new Blob([await zipFiles(files)], { type: 'application/zip' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'love-playground-projects.zip';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    status.textContent = `Downloaded ${projects.length} project${projects.length === 1 ? '' : 's'}.`;
  } catch (err) {
    status.textContent = `Couldn't make the zip: ${err.message}`;
  } finally {
    button.disabled = false;
  }
}

async function load() {
  let projects;
  try {
    projects = await listProjects();
  } catch (err) {
    status.textContent = `Couldn't read your saved projects: ${err.message}`;
    return;
  }

  if (!projects.length) {
    status.textContent = 'There are no LÖVE projects saved in this browser.';
    return;
  }

  for (const project of projects) {
    const item = document.createElement('li');
    item.textContent = project.name;
    const when = document.createElement('span');
    when.textContent = `edited ${new Date(project.updated).toLocaleDateString()}`;
    item.append(when);
    list.append(item);
  }
  button.hidden = false;
  button.addEventListener('click', () => download(projects));
}

load();
