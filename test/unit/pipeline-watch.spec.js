import {afterAll, describe, expect, it, vi} from 'vitest';

const backend = {builds: {}};
const settings = {};
vi.mock('../../app/common/renderer/polyfills.js', () => ({
  backend,
  getSetting: vi.fn(async (key) => settings[key]),
  setSetting: vi.fn(async (key, value) => {
    settings[key] = value;
  }),
}));
vi.mock('../../app/common/renderer/i18next.js', () => ({default: {t: (key) => key}}));
vi.mock('../../app/common/renderer/actions/Workstation.js', () => ({selectApp: (id) => ({type: 'SELECT_APP', id})}));
vi.mock('../../app/common/renderer/utils/notification.js', () => ({notification: {success: vi.fn()}}));

const watches = await import('../../app/common/renderer/components/Builds/pipeline-watch.js');

const LINK = 'https://git.example.ua/mob/android/app/-/pipelines/2158355';
const job = (id, name, status, archive = false) => ({
  id,
  name,
  stage: 'build',
  status,
  project: 'mob/android/app',
  artifacts: archive ? [{file_type: 'archive'}] : [],
});
let jobs = [job(1, 'build', 'running'), job(2, 'lint', 'success')];

backend.builds = {
  pipelineStatus: vi.fn(async () => ({ok: true, pipeline: {id: 2158355, status: 'running', ref: 'develop'}, jobs})),
  pipelinePlay: vi.fn(async () => ({ok: true})),
  onProgress: () => () => {},
  gitlabFetch: vi.fn(async () => ({
    ok: true,
    candidates: [
      {name: 'app.aab', entry: 'out/app.aab', folder: false},
      {name: 'app-debug.apk', entry: 'out/app-debug.apk', folder: false},
    ],
  })),
  gitlabExtract: vi.fn(async (_jobId, candidate) => ({ok: true, file: `/tmp/${candidate.name}`})),
  inspect: vi.fn(async (file) => ({ok: true, build: {file, platform: 'android', appId: 'ua.app', version: '7.15'}})),
  install: vi.fn(async () => ({ok: true})),
  uninstall: vi.fn(async () => ({ok: true})),
};

const emulator = {
  id: 'emulator-5554',
  kind: 'android-emulator',
  state: 'running',
  name: 'Pixel',
  platformName: 'Android',
};
const store = {
  getState: () => ({workstation: {devices: [emulator], deviceId: emulator.id}}),
  dispatch: vi.fn(),
};
await watches.startPipelineWatches(store);
afterAll(() => watches.stopPipelineWatches());

describe('a pipeline followed for its build', function () {
  it('asks which jobs make the build of a new project, then waits for the job', async function () {
    const {id} = watches.addWatch(LINK);
    expect(id).toBe('mob/android/app#2158355');
    await vi.waitFor(() => expect(watches.getWatch(id).status).toBe('configure'));
    expect(watches.getWatch(id).suggested).toEqual(['build']);
    expect(watches.getWatch(id).targets).toEqual(['emulator-5554']);

    await watches.saveProjectJobs('mob/android/app', ['build']);
    await vi.waitFor(() => expect(watches.getWatch(id).status).toBe('waiting'));
  });

  it('takes the APK of the finished job and installs it where it was sent', async function () {
    const id = 'mob/android/app#2158355';
    jobs = [job(1, 'build', 'success', true)];
    await watches.refresh(id);
    await vi.waitFor(() => expect(watches.getWatch(id).status).toBe('installed'));
    expect(backend.builds.gitlabFetch).toHaveBeenCalledWith(1, 'mob/android/app');
    expect(backend.builds.gitlabExtract.mock.calls[0][1].name).toBe('app-debug.apk');
    expect(backend.builds.install).toHaveBeenCalledWith(emulator, '/tmp/app-debug.apk', {allowDowngrade: true});
    expect(store.dispatch).toHaveBeenCalledWith({type: 'SELECT_APP', id: 'ua.app'});
    // a finished pipeline is not followed again after a restart
    expect(settings.PIPELINE_WATCHES).toEqual([]);
  });

  it('turns down what is not a pipeline link', function () {
    expect(watches.addWatch('https://example.com/nothing').error).toBe('buildsPipelineBadLink');
  });
});
