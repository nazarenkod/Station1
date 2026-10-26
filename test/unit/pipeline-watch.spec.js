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

const job = (id, name, status, project, archive = false) => ({
  id,
  name,
  stage: 'build',
  status,
  project,
  artifacts: archive ? [{file_type: 'archive'}] : [],
});
const pipelines = {
  'mob/android/app': [job(1, 'build', 'running', 'mob/android/app'), job(2, 'lint', 'success', 'mob/android/app')],
  'mob/ios/app': [job(11, 'build_sim', 'success', 'mob/ios/app', true), job(12, 'build_ipa', 'running', 'mob/ios/app')],
};
const archives = {
  1: [
    {name: 'app.aab', entry: 'out/app.aab', folder: false},
    {name: 'app-debug.apk', entry: 'out/app-debug.apk', folder: false},
  ],
  11: [{name: 'App.app', entry: 'Sim/App.app', folder: true}],
  12: [
    {name: 'App.ipa', entry: 'out/App.ipa', folder: false},
    {name: 'App-adhoc.ipa', entry: 'out/App-adhoc.ipa', folder: false},
  ],
};

backend.builds = {
  pipelineStatus: vi.fn(async ({project}) => ({
    ok: true,
    pipeline: {id: 7, status: 'running', ref: 'develop'},
    jobs: pipelines[project],
  })),
  pipelinePlay: vi.fn(async () => ({ok: true})),
  onProgress: () => () => {},
  gitlabFetch: vi.fn(async (jobId) => ({ok: true, candidates: archives[jobId]})),
  gitlabExtract: vi.fn(async (_jobId, candidate) => ({ok: true, file: `/tmp/${candidate.name}`})),
  inspect: vi.fn(async (file) => ({
    ok: true,
    build: {file, platform: /apk/.test(file) ? 'android' : 'ios', appId: 'ua.app', version: '7.15'},
  })),
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
const simulator = {id: 'SIM', kind: 'ios-simulator', state: 'running', name: 'iPhone 15', platformName: 'iOS'};
const iphone = {id: 'PHONE', kind: 'ios-device', state: 'running', name: 'iPhone 17 Pro', platformName: 'iOS'};
const store = {
  getState: () => ({workstation: {devices: [emulator, simulator, iphone], deviceId: emulator.id}}),
  dispatch: vi.fn(),
};
await watches.startPipelineWatches(store);
afterAll(() => watches.stopPipelineWatches());

const rule = (project, virtual, real = [], realFile = '') => ({
  id: project,
  project,
  virtual: {jobs: virtual, file: ''},
  real: {jobs: real, file: realFile},
});

describe('a pipeline followed for its build', function () {
  const id = 'mob/android/app#7';

  it('asks once where a new project’s build comes from, then waits for its job', async function () {
    expect(watches.addWatch('https://git.example.ua/mob/android/app/-/pipelines/7').id).toBe(id);
    await vi.waitFor(() => expect(watches.getWatch(id).status).toBe('configure'));
    expect(watches.getWatch(id).suggested).toEqual(['build']);

    await watches.saveBuildSources([rule('android/app', ['build'])]);
    await vi.waitFor(() => expect(watches.getWatch(id).builds.virtual?.status).toBe('waiting'));
    expect(watches.getWatch(id).rule).toBe('android/app');
  });

  it('takes the APK of the finished job and installs it where it was sent', async function () {
    pipelines['mob/android/app'] = [job(1, 'build', 'success', 'mob/android/app', true)];
    await watches.refresh(id);
    await vi.waitFor(() => expect(watches.getWatch(id).builds.virtual.status).toBe('installed'));
    expect(backend.builds.install).toHaveBeenCalledWith(emulator, '/tmp/app-debug.apk', {allowDowngrade: true});
    expect(store.dispatch).toHaveBeenCalledWith({type: 'SELECT_APP', id: 'ua.app'});
  });

  it('gives a simulator its .app and a real iPhone its IPA, each from its own job', async function () {
    await watches.saveBuildSources([
      rule('android/app', ['build']),
      rule('mob/ios/*', ['build_sim'], ['build_ipa'], 'App.ipa'),
    ]);
    const ios = watches.addWatch('https://git.example.ua/mob/ios/app/-/pipelines/7', {targets: ['SIM', 'PHONE']}).id;
    await vi.waitFor(() => expect(watches.getWatch(ios).builds.virtual?.status).toBe('installed'));
    expect(watches.getWatch(ios).builds.real.status).toBe('waiting');
    expect(backend.builds.install).toHaveBeenCalledWith(simulator, '/tmp/App.app', {allowDowngrade: true});

    pipelines['mob/ios/app'][1] = job(12, 'build_ipa', 'success', 'mob/ios/app', true);
    await watches.refresh(ios);
    await vi.waitFor(() => expect(watches.getWatch(ios).builds.real.status).toBe('installed'));
    expect(backend.builds.install).toHaveBeenCalledWith(iphone, '/tmp/App.ipa', {allowDowngrade: true});
    // what is through is not followed again after a restart
    expect(settings.PIPELINE_WATCHES).toEqual([]);
  });

  it('turns down what is not a pipeline link', function () {
    expect(watches.addWatch('https://example.com/nothing').error).toBe('buildsPipelineBadLink');
  });
});
