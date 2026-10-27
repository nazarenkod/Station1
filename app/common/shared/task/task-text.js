// The task a person works on, as text: its key from what was typed, the
// links in its description and comments (merge requests, Confluence pages),
// a Confluence page as plain text, and the size of a diff.

const KEY = /\b([A-Z][A-Z0-9_]{1,15}-\d{1,7})\b/;

/**
 * The key of a Jira task from a key or a link: `PAY-123`,
 * `https://acme.atlassian.net/browse/PAY-123`, `…?selectedIssue=PAY-123`.
 * @returns {string | null}
 */
export function parseTaskKey(input) {
  const text = String(input ?? '').trim();
  if (!text) {
    return null;
  }
  try {
    const url = new URL(text);
    const selected = url.searchParams.get('selectedIssue');
    if (selected && KEY.test(selected.toUpperCase())) {
      return selected.toUpperCase();
    }
    const browse = /\/browse\/([^/?#]+)/.exec(url.pathname);
    if (browse) {
      return KEY.exec(browse[1].toUpperCase())?.[1] ?? null;
    }
  } catch {
    // not a link: a key, perhaps in lower case
  }
  return KEY.exec(text.toUpperCase())?.[1] ?? null;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"'|\])}]+/g;

const originOf = (url) => {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).origin;
  } catch {
    return null;
  }
};

/**
 * The merge requests of a GitLab site and the Confluence pages of a Jira
 * site that a text links to, each once. Links to other sites stay links.
 * @param {string[]} texts
 * @param {{jira?: string, gitlab?: string}} sites
 */
export function findLinks(texts, {jira, gitlab} = {}) {
  const jiraOrigin = jira ? originOf(jira) : null;
  const gitlabOrigin = gitlab ? originOf(gitlab) : null;
  const mrs = new Map();
  const pages = new Map();
  const other = new Set();
  for (const text of texts) {
    for (const raw of String(text ?? '').match(URL_IN_TEXT) ?? []) {
      const url = raw.replace(/[.,;:]+$/, '');
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        continue;
      }
      const mr = /^\/(.+?)\/-\/merge_requests\/(\d+)/.exec(parsed.pathname);
      if (mr) {
        const key = `${parsed.origin}/${mr[1]}!${mr[2]}`;
        if (!mrs.has(key)) {
          mrs.set(key, {
            url: `${parsed.origin}/${mr[1]}/-/merge_requests/${mr[2]}`,
            origin: parsed.origin,
            project: mr[1],
            iid: Number(mr[2]),
            ours: !gitlabOrigin || parsed.origin === gitlabOrigin,
          });
        }
        continue;
      }
      if (parsed.pathname.startsWith('/wiki/')) {
        const id = /\/pages\/(\d+)/.exec(parsed.pathname)?.[1] ?? parsed.searchParams.get('pageId');
        if (id && !pages.has(id)) {
          pages.set(id, {id, url, ours: !jiraOrigin || parsed.origin === jiraOrigin});
        }
        continue;
      }
      other.add(url);
    }
  }
  return {mrs: [...mrs.values()], pages: [...pages.values()], other: [...other]};
}

const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};

/** A Confluence page in its storage format as plain text, at most `limit` characters. */
export function storageToText(html, limit = 20000) {
  const text = String(html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|h\d|li|tr|br)>|<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|\w+);/g, (_match, name) =>
      name.startsWith('#') ? String.fromCharCode(Number(name.slice(1))) : (ENTITIES[name] ?? ' '),
    )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {text: text.slice(0, limit), cut: text.length > limit};
}

/** Lines added and removed in a unified diff, its headers left out. */
export function diffStats(diff) {
  let additions = 0;
  let deletions = 0;
  for (const line of String(diff ?? '').split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions++;
    }
  }
  return {additions, deletions};
}

/** Jira text cut to a size the context can afford, with a mark where it was cut. */
export function clip(text, limit) {
  const value = String(text ?? '').trim();
  return value.length > limit ? `${value.slice(0, limit)}… [cut, ${value.length} characters]` : value;
}
