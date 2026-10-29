import {randomBytes} from 'node:crypto';
import {mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

// The packages of screen objects a person saved after a session, by project,
// on this Mac only: a folder for each package with its description and the
// reduced screenshot of each state. The code the model writes is kept in the
// description, next to its screen object; nothing goes to the autotests
// repository.

const SAFE_ID = /^[\w-]+$/;

const newId = (prefix) => `${prefix}-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

/** What the list of packages shows: no elements, no code. */
export function packageOutline(pack) {
  return {
    id: pack.id,
    name: pack.name,
    createdAt: pack.createdAt,
    platform: pack.platform,
    device: pack.device ?? null,
    app: pack.app ?? null,
    objects: pack.objects.length,
    generated: pack.objects.filter((object) => object.code).length,
    ready: !!pack.ready,
    takenAt: pack.takenAt ?? null,
  };
}

/**
 * @param {string} dir the folder of the packages, in the station's data
 */
export function createPackagesStore(dir) {
  const folderOf = (profileId, id = null) => {
    if (!SAFE_ID.test(profileId) || (id !== null && !SAFE_ID.test(id))) {
      throw new Error('Not a package');
    }
    return id === null ? path.join(dir, profileId) : path.join(dir, profileId, id);
  };
  const fileOf = (profileId, id) => path.join(folderOf(profileId, id), 'package.json');

  const read = async (profileId, id) => {
    try {
      return JSON.parse(await readFile(fileOf(profileId, id), 'utf8'));
    } catch {
      return null;
    }
  };
  const write = async (profileId, pack) => {
    await writeFile(fileOf(profileId, pack.id), `${JSON.stringify(pack, null, 1)}\n`);
    return pack;
  };

  return {
    async list(profileId) {
      let ids;
      try {
        ids = await readdir(folderOf(profileId));
      } catch {
        return [];
      }
      const packs = await Promise.all(ids.filter((id) => SAFE_ID.test(id)).map((id) => read(profileId, id)));
      return packs
        .filter(Boolean)
        .map(packageOutline)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    get: read,

    /**
     * Keeps the screen objects chosen after a session. Each state brings its
     * reduced screenshot (JPEG, base64), kept as a file next to the package.
     */
    async save(profileId, {name, platform, device = null, app = null, objects}, now = new Date()) {
      const id = newId('pk');
      const folder = folderOf(profileId, id);
      await mkdir(folder, {recursive: true});
      const kept = [];
      for (const object of objects) {
        const states = [];
        for (const state of object.states) {
          const shot = state.shot ? `${newId('s')}.jpg` : null;
          if (shot) {
            await writeFile(path.join(folder, shot), Buffer.from(state.shot, 'base64'));
          }
          states.push({title: state.title, shot});
        }
        kept.push({
          id: newId('so'),
          name: object.name,
          screen: object.screen,
          states,
          elements: object.elements,
          code: null,
          generatedAt: null,
        });
      }
      const pack = {
        id,
        name,
        createdAt: now.toISOString(),
        platform,
        device,
        app,
        ready: false,
        takenAt: null,
        objects: kept,
      };
      return packageOutline(await write(profileId, pack));
    },

    /** Changes a package; `change` gets it and gives it back changed. */
    async update(profileId, id, change) {
      const pack = await read(profileId, id);
      if (!pack) {
        return null;
      }
      return await write(profileId, change(structuredClone(pack)));
    },

    /** The reduced screenshot of a state, base64, or null. */
    async shot(profileId, id, file) {
      if (!SAFE_ID.test(String(file).replace(/\.jpg$/, ''))) {
        return null;
      }
      try {
        return (await readFile(path.join(folderOf(profileId, id), file))).toString('base64');
      } catch {
        return null;
      }
    },

    async remove(profileId, id) {
      await rm(folderOf(profileId, id), {recursive: true, force: true});
    },

    /** Every package of a project goes with the project. */
    async removeProject(profileId) {
      await rm(folderOf(profileId), {recursive: true, force: true});
    },
  };
}
