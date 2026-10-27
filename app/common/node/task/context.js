import {clip, diffStats, findLinks, storageToText} from '../../shared/task/task-text.js';

// The context of a task, gathered by plain code, no AI: the task in Jira,
// its sub-tasks, parent and linked tasks one level deep, the Confluence pages
// and merge requests their texts link to, and the commits with the key in
// the development branch. A source that fails leaves a note; the rest still
// comes.

const ISSUE_FIELDS =
  'summary,issuetype,status,assignee,reporter,fixVersions,description,labels,components,subtasks,parent,issuelinks,comment,attachment,updated,priority';
const COMMENTS = 20;
const LINKED = 12;
const PAGE_LIMIT = 20000;
const DESCRIPTION_LIMIT = 12000;
const COMMENT_LIMIT = 2000;

const brief = (issue) => ({
  key: issue.key,
  summary: issue.fields?.summary ?? '',
  type: issue.fields?.issuetype?.name ?? null,
  status: issue.fields?.status?.name ?? null,
  // new, indeterminate or done: the card colours the status by it
  statusCategory: issue.fields?.status?.statusCategory?.key ?? null,
});

function issueOf(raw, {full = true} = {}) {
  const fields = raw.fields ?? {};
  const comments = fields.comment?.comments ?? [];
  return {
    ...brief(raw),
    assignee: fields.assignee?.displayName ?? null,
    priority: fields.priority?.name ?? null,
    fixVersions: (fields.fixVersions ?? []).map((version) => version.name),
    labels: fields.labels ?? [],
    components: (fields.components ?? []).map((component) => component.name),
    updated: fields.updated ?? null,
    description: full ? clip(fields.description ?? '', DESCRIPTION_LIMIT) : undefined,
    comments: full
      ? comments.slice(-COMMENTS).map((comment) => ({
          author: comment.author?.displayName ?? '',
          at: comment.created ?? null,
          text: clip(comment.body ?? '', COMMENT_LIMIT),
        }))
      : undefined,
    attachments: (fields.attachment ?? []).map((file) => file.filename),
  };
}

// every linked task of one level: sub-tasks, the parent, links of any type
function relatives(raw) {
  const fields = raw.fields ?? {};
  const list = [];
  for (const sub of fields.subtasks ?? []) {
    list.push({key: sub.key, relation: 'subtask'});
  }
  if (fields.parent?.key) {
    list.push({key: fields.parent.key, relation: 'parent'});
  }
  for (const link of fields.issuelinks ?? []) {
    const other = link.outwardIssue ?? link.inwardIssue;
    if (other?.key) {
      list.push({key: other.key, relation: link.outwardIssue ? link.type?.outward : link.type?.inward});
    }
  }
  const seen = new Set();
  return list.filter((one) => !seen.has(one.key) && seen.add(one.key));
}

const problem = (source, error) => ({
  source,
  error: error?.status === 404 ? 'notFound' : error?.status === 401 || error?.status === 403 ? 'access' : 'failed',
  detail: String(error?.message ?? error).slice(0, 300),
});

/**
 * @param {object} deps
 * @param {string} deps.key
 * @param {{get: (path: string) => Promise<any>, site: string} | null} deps.jira requests to the Jira site with its token
 * @param {{request: (path: string) => Promise<any>, site: string} | null} deps.gitlab
 * @param {{log: (key: string) => Promise<{sha: string, subject: string}[]>} | null} deps.git the main repository of the profile
 */
export async function collectTaskContext({key, jira, gitlab, git}) {
  if (!jira) {
    return {ok: false, error: 'jiraNotSetUp'};
  }
  let raw;
  try {
    raw = await jira.get(`/rest/api/2/issue/${encodeURIComponent(key)}?fields=${ISSUE_FIELDS}`);
  } catch (error) {
    return {ok: false, ...problem('task', error)};
  }
  const problems = [];
  const task = issueOf(raw);
  const remote = await jira.get(`/rest/api/2/issue/${encodeURIComponent(key)}/remotelink`).catch(() => []);

  // linked tasks one level deep; those that hold the development of this one come whole
  const linked = [];
  for (const relative of relatives(raw).slice(0, LINKED)) {
    try {
      const other = await jira.get(`/rest/api/2/issue/${encodeURIComponent(relative.key)}?fields=${ISSUE_FIELDS}`);
      linked.push({...issueOf(other), relation: relative.relation});
    } catch (error) {
      problems.push(problem(`linked:${relative.key}`, error));
    }
  }

  const texts = [
    task.description,
    ...task.comments.map((comment) => comment.text),
    ...(Array.isArray(remote) ? remote.map((link) => link.object?.url ?? '') : []),
    ...linked.flatMap((one) => [one.description, ...(one.comments ?? []).map((comment) => comment.text)]),
  ];
  const links = findLinks(texts, {jira: jira.site, gitlab: gitlab?.site});

  const pages = [];
  for (const page of links.pages) {
    if (!page.ours) {
      pages.push({...page, skipped: 'otherSite'});
      continue;
    }
    try {
      const content = await jira.get(`/wiki/rest/api/content/${page.id}?expand=body.storage,space,version`);
      const {text, cut} = storageToText(content.body?.storage?.value, PAGE_LIMIT);
      pages.push({id: page.id, url: page.url, title: content.title, space: content.space?.key ?? null, text, cut});
    } catch (error) {
      problems.push(problem(`page:${page.id}`, error));
      pages.push({...page, skipped: 'failed'});
    }
  }

  const mrs = [];
  for (const mr of links.mrs) {
    if (!gitlab || !mr.ours) {
      mrs.push({url: mr.url, iid: mr.iid, project: mr.project, skipped: gitlab ? 'otherSite' : 'gitlabNotSetUp'});
      continue;
    }
    const project = encodeURIComponent(mr.project);
    try {
      const info = await gitlab.request(`/projects/${project}/merge_requests/${mr.iid}`);
      const changes = await gitlab
        .request(`/projects/${project}/merge_requests/${mr.iid}/diffs?per_page=100`)
        .catch(
          async () => (await gitlab.request(`/projects/${project}/merge_requests/${mr.iid}/changes`)).changes ?? [],
        );
      mrs.push({
        url: mr.url,
        iid: mr.iid,
        project: mr.project,
        title: info.title,
        state: info.state,
        sourceBranch: info.source_branch,
        targetBranch: info.target_branch,
        sha: info.sha,
        files: (changes ?? []).map((change) => ({
          path: change.new_path ?? change.old_path,
          ...diffStats(change.diff),
          status: change.new_file
            ? 'added'
            : change.deleted_file
              ? 'deleted'
              : change.renamed_file
                ? 'renamed'
                : 'modified',
        })),
      });
    } catch (error) {
      problems.push(problem(`mr:${mr.url}`, error));
      mrs.push({url: mr.url, iid: mr.iid, project: mr.project, skipped: 'failed'});
    }
  }

  let commits = [];
  if (git) {
    try {
      commits = await git.log(key);
    } catch (error) {
      problems.push(problem('commits', error));
    }
  }

  return {
    ok: true,
    context: {
      key,
      url: `${jira.site.replace(/\/+$/, '')}/browse/${key}`,
      fetchedAt: new Date().toISOString(),
      task,
      linked,
      pages,
      mrs,
      commits,
      otherLinks: links.other.slice(0, 30),
      problems,
    },
  };
}
