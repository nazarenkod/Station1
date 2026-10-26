import {describe, expect, it} from 'vitest';

import {GitLabService} from '../../app/common/node/gitlab/service.js';

const answers = {
  '/projects/qa%2Ftests/pipelines/10': {id: 10, status: 'running', ref: 'main', sha: 'abcdef0123', web_url: 'u'},
  '/projects/qa%2Ftests/pipelines/10/jobs?per_page=100': [
    {id: 1, name: 'trigger_build', stage: 's', status: 'success'},
  ],
  '/projects/qa%2Ftests/pipelines/10/bridges?per_page=100': [{downstream_pipeline: {id: 77, project_id: 5}}],
  '/projects/5/pipelines/77/jobs?per_page=100': [
    {id: 9, name: 'build', stage: 'build', status: 'success', artifacts: [{file_type: 'archive', size: 3}]},
  ],
};

const service = new GitLabService({
  getSettings: async () => ({url: 'https://git.example.ua'}),
  getToken: async () => 'token',
  fetchImpl: async (url) => {
    const key = url.replace('https://git.example.ua/api/v4', '');
    return key in answers
      ? {ok: true, json: async () => answers[key]}
      : {ok: false, status: 404, json: async () => ({})};
  },
});

describe('a pipeline read from GitLab', function () {
  it('has its jobs and those of the pipelines it triggers', async function () {
    const result = await service.pipelineStatus({
      origin: 'https://git.example.ua',
      project: 'qa/tests',
      pipelineId: 10,
    });
    expect(result.ok).toBe(true);
    expect(result.pipeline).toMatchObject({id: 10, status: 'running', sha: 'abcdef01'});
    expect(result.jobs.map((job) => [job.name, job.project, job.downstream])).toEqual([
      ['trigger_build', 'qa/tests', false],
      ['build', '5', true],
    ]);
  });

  it('turns down a link to another GitLab, and says when a pipeline is not there', async function () {
    expect(
      await service.pipelineStatus({origin: 'https://gitlab.com', project: 'qa/tests', pipelineId: 10}),
    ).toMatchObject({ok: false, code: 'otherSite'});
    expect(
      await service.pipelineStatus({origin: 'https://git.example.ua', project: 'qa/tests', pipelineId: 11}),
    ).toMatchObject({ok: false, code: 'notFound'});
  });
});
