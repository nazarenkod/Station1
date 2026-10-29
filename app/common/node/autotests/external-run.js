import {limitAnswer} from '../../shared/autotests/external-tools.js';
import {elementLine} from '../../shared/autotests/screen-objects.js';

// What the test agent's tools do in the station: the packages of a project
// and the screen objects of one, read only. Giving a package away marks it
// taken, so the person sees the test agent has it.

const day = (iso) =>
  String(iso ?? '')
    .slice(0, 16)
    .replace('T', ' ');

/**
 * @param {object} deps
 * @param {ReturnType<import('./packages.js').createPackagesStore>} deps.packages
 * @param {() => Promise<{activeId: string, list: {id: string, name: string}[]}>} deps.profiles
 * @param {() => Promise<RegExp[]>} deps.masks
 * @param {() => Date} [deps.now]
 * @returns {Record<string, (args: object) => Promise<{text: string, images?: object[]}>>}
 */
export function externalTools({packages, profiles, masks, now = () => new Date()}) {
  const projectOf = async (name) => {
    const all = await profiles();
    if (!name) {
      return all.list.find((profile) => profile.id === all.activeId);
    }
    const found = all.list.find((profile) => profile.name.toLowerCase() === String(name).toLowerCase());
    if (!found) {
      throw new Error(`no project «${name}»; the projects: ${all.list.map((profile) => profile.name).join(', ')}`);
    }
    return found;
  };

  return {
    async autotests_packages({project}) {
      const profile = await projectOf(project);
      const list = await packages.list(profile.id);
      if (!list.length) {
        return {text: `Project «${profile.name}» has no packages of screen objects yet.`};
      }
      const lines = list.map(
        (pack) =>
          `- ${pack.id} «${pack.name}» ${day(pack.createdAt)} ${pack.platform}` +
          `${pack.app?.id ? ` ${pack.app.id}${pack.app.version ? ` ${pack.app.version}` : ''}` : ''}` +
          ` · ${pack.objects} screen objects, ${pack.generated} with code` +
          `${pack.ready ? ' · ready for autotests' : ''}${pack.takenAt ? ` · taken ${day(pack.takenAt)}` : ''}`,
      );
      return {text: [`Project «${profile.name}»:`, ...lines].join('\n')};
    },

    async autotests_package_get({package: wanted, project, screen_object: only, elements, screenshots}) {
      const profile = await projectOf(project);
      const list = await packages.list(profile.id);
      const outline =
        list.find((pack) => pack.id === wanted) ??
        list.find((pack) => pack.name.toLowerCase() === String(wanted ?? '').toLowerCase());
      if (!outline) {
        throw new Error(`no package «${wanted}» in project «${profile.name}»`);
      }
      const pack = await packages.get(profile.id, outline.id);
      const objects = only
        ? pack.objects.filter((object) => object.name.toLowerCase() === String(only).toLowerCase())
        : pack.objects;
      if (!objects.length) {
        throw new Error(
          `no screen object «${only}»; there are: ${pack.objects.map((object) => object.name).join(', ')}`,
        );
      }
      const compiled = await masks();
      const images = [];
      const blocks = [];
      for (const object of objects) {
        const block = [
          `## ${object.name}`,
          `Screen: ${object.screen}; states: ${object.states.map((state) => state.title).join(', ')}`,
        ];
        block.push(
          object.code ? `\`\`\`kotlin\n${object.code}\n\`\`\`` : 'No code yet: the person has not generated it.',
        );
        if (elements) {
          block.push(
            `Elements (${object.elements.length}):`,
            ...object.elements.map((one) => elementLine(one, compiled)),
          );
        }
        if (screenshots) {
          for (const state of object.states) {
            const data = state.shot ? await packages.shot(profile.id, pack.id, state.shot) : null;
            if (data) {
              images.push({data, mimeType: 'image/jpeg'});
            }
          }
        }
        blocks.push(block.join('\n'));
      }
      await packages.update(profile.id, pack.id, (kept) => ({...kept, takenAt: now().toISOString()}));
      const head = `Package «${pack.name}» (${pack.platform}${pack.app?.id ? `, ${pack.app.id}` : ''})${pack.ready ? ', ready for autotests' : ', not marked ready yet'}`;
      return {text: limitAnswer([head, ...blocks].join('\n\n')), images};
    },
  };
}
