import {impactCounts} from './impact.js';

// The context of a task as the agent reads it: a short outline first, a part
// in full only when asked, so the agent pays for what it needs.

export const TASK_PARTS = ['outline', 'task', 'linked', 'pages', 'mrs', 'commits', 'impact'];

const line = (issue) => `${issue.key} [${issue.type ?? '?'} · ${issue.status ?? '?'}] ${issue.summary}`;

function outline(context) {
  const {task, linked, pages, mrs, commits, problems} = context;
  return [
    `Task ${line(task)}`,
    task.fixVersions?.length ? `Fix versions: ${task.fixVersions.join(', ')}` : null,
    `Description: ${task.description ? `${task.description.length} characters` : 'none'}; comments: ${task.comments.length}`,
    linked.length
      ? `Linked: ${linked.map((one) => `${one.relation ?? 'link'} ${line(one)}`).join('; ')}`
      : 'Linked: none',
    pages.length ? `Pages: ${pages.map((page) => page.title ?? page.url).join('; ')}` : 'Pages: none',
    mrs.length
      ? `Merge requests: ${mrs
          .map((mr) =>
            mr.skipped
              ? `${mr.url} (not loaded: ${mr.skipped})`
              : `!${mr.iid} ${mr.title} [${mr.state}] ${mr.sourceBranch} → ${mr.targetBranch}, ${mr.files.length} files`,
          )
          .join('; ')}`
      : 'Merge requests: none in the comments',
    `Commits with the key in the development branch: ${commits.length}`,
    context.impact
      ? `Impact analysis: saved ${context.impact.at}${context.impact.stale ? ', stale' : ''}`
      : 'Impact analysis: none yet',
    problems.length ? `Not loaded: ${problems.map((one) => `${one.source} (${one.error})`).join('; ')}` : null,
    'Ask for a part: task, linked, pages, mrs, commits, impact.',
  ]
    .filter(Boolean)
    .join('\n');
}

const issueText = (issue) =>
  [
    line(issue),
    issue.relation ? `Relation: ${issue.relation}` : null,
    issue.description ? `Description:\n${issue.description}` : null,
    ...(issue.comments ?? []).map((comment) => `Comment by ${comment.author} (${comment.at}):\n${comment.text}`),
  ]
    .filter(Boolean)
    .join('\n\n');

/** One part of the context as text; the outline when no part is given. */
export function taskForAgent(context, part = 'outline') {
  if (!context) {
    return 'No task is chosen in the station.';
  }
  switch (part) {
    case 'task':
      return issueText(context.task);
    case 'linked':
      return context.linked.length ? context.linked.map(issueText).join('\n\n---\n\n') : 'No linked tasks.';
    case 'pages':
      return context.pages.length
        ? context.pages
            .map((page) =>
              page.skipped ? `${page.url}: not loaded (${page.skipped})` : `# ${page.title}\n${page.text}`,
            )
            .join('\n\n---\n\n')
        : 'No Confluence pages.';
    case 'mrs':
      return context.mrs.length
        ? context.mrs
            .map((mr) =>
              mr.skipped
                ? `${mr.url}: not loaded (${mr.skipped})`
                : [
                    `!${mr.iid} ${mr.title} [${mr.state}] ${mr.sourceBranch} → ${mr.targetBranch} (${mr.url})`,
                    ...mr.files.map((file) => `  ${file.status} ${file.path} +${file.additions} -${file.deletions}`),
                  ].join('\n'),
            )
            .join('\n\n')
        : 'No merge requests in the comments of the task or its linked tasks.';
    case 'commits':
      return context.commits.length
        ? context.commits.map((commit) => `${commit.sha.slice(0, 10)} ${commit.subject}`).join('\n')
        : 'No commits with the key in the development branch.';
    case 'impact': {
      const impact = context.impact;
      if (!impact) {
        return 'No impact analysis yet.';
      }
      const counts = impactCounts(impact.items);
      return [
        `Impact analysis of ${impact.at}${impact.stale ? ' (stale: the merge requests or the task changed since)' : ''}: ${counts.check} checks, ${counts.regress} regression risks.`,
        ...impact.items.map((item) => `- [${item.section}]${item.important ? ' !' : ''} ${item.text}`),
      ].join('\n');
    }
    default:
      return outline(context);
  }
}
