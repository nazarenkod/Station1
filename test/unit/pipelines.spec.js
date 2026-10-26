import {describe, expect, it} from 'vitest';

import {
  chooseCandidate,
  likelyArtifactJobs,
  parsePipelineUrl,
  pickArtifactJob,
} from '../../app/common/shared/builds/pipelines.js';

const job = (id, name, status, archive = false) => ({
  id,
  name,
  status,
  artifacts: archive ? [{file_type: 'archive'}] : [],
});

describe('GitLab links', function () {
  it('reads the site, the project and the pipeline or job', function () {
    expect(
      parsePipelineUrl(
        'https://git.privatbank.ua/DN001R000005/dn001r000005_0/p24-front-end-mob/android/ap24v6/-/pipelines/2158355',
      ),
    ).toEqual({
      origin: 'https://git.privatbank.ua',
      project: 'DN001R000005/dn001r000005_0/p24-front-end-mob/android/ap24v6',
      pipelineId: 2158355,
    });
    expect(parsePipelineUrl(' https://gitlab.com/a/b/-/jobs/42/ ')).toMatchObject({project: 'a/b', jobId: 42});
    expect(parsePipelineUrl('https://gitlab.com/a/b/-/merge_requests/1')).toBeNull();
    expect(parsePipelineUrl('not a link')).toBeNull();
  });
});

describe('the job the build comes from', function () {
  const names = ['build', 'build_bundle'];

  it('takes the first job by the order set that finished with artifacts, the latest retry of it', function () {
    const jobs = [job(1, 'build', 'failed'), job(3, 'build', 'success', true), job(2, 'build_bundle', 'manual')];
    expect(pickArtifactJob(jobs, names)).toMatchObject({state: 'ready', job: {id: 3}});
  });

  it('waits for a running job, offers to start a manual one, and says when there is none', function () {
    expect(pickArtifactJob([job(1, 'build', 'running')], names).state).toBe('waiting');
    expect(pickArtifactJob([job(1, 'build', 'failed'), job(2, 'build_bundle', 'manual')], names)).toMatchObject({
      state: 'manual',
      job: {id: 2},
    });
    expect(pickArtifactJob([job(1, 'build', 'success')], names).state).toBe('noArtifacts');
    expect(pickArtifactJob([job(1, 'build', 'failed')], names).state).toBe('failed');
    expect(pickArtifactJob([job(1, 'lint', 'success')], names).state).toBe('missing');
  });

  it('ticks at first the jobs that look like builds', function () {
    expect(
      likelyArtifactJobs([
        job(1, 'lint', 'success'),
        job(2, 'build_release_google', 'manual'),
        job(3, 'x', 'success', true),
      ]),
    ).toEqual(['build_release_google', 'x']);
  });
});

describe('the build taken out of the archive', function () {
  const apk = (name) => ({name, entry: `out/${name}`, folder: false});

  it('takes what the devices install and leaves bundles out', function () {
    expect(chooseCandidate([apk('app.aab'), apk('app.apk')], {platforms: ['android']}).name).toBe('app.apk');
    const sim = {name: 'App.app', entry: 'App.app', folder: true};
    expect(chooseCandidate([apk('App.ipa'), sim], {platforms: ['ios'], simulator: true})).toBe(sim);
    expect(chooseCandidate([apk('App.ipa'), sim], {platforms: ['ios']}).name).toBe('App.ipa');
  });

  it('takes the one picked last time, with another build number, or a universal one, else asks', function () {
    const two = [apk('app-debug-7151.apk'), apk('app-release-7151.apk')];
    expect(chooseCandidate(two, {platforms: ['android'], remembered: 'app-release-7150.apk'}).name).toBe(
      'app-release-7151.apk',
    );
    expect(chooseCandidate([apk('a-arm64.apk'), apk('a-universal.apk')], {platforms: ['android']}).name).toBe(
      'a-universal.apk',
    );
    expect(chooseCandidate(two, {platforms: ['android']})).toBeNull();
  });
});
