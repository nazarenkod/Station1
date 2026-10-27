// Ported from vision (backend/src/a11y/jira.client.ts): keep in sync until both use a shared package.

export interface JiraConfig {
  url: string;
  token: string;
  // Jira Cloud authenticates with email + API token; Server/Data Center with a personal access token
  email?: string | null;
}

export class JiraError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface JiraIssueType {
  id: string;
  name: string;
  subtask: boolean;
}

export interface JiraLinkType {
  name: string;
  inward: string;
  outward: string;
}

export interface JiraAllowedValue {
  id: string;
  value?: string;
  name?: string;
}

/** A field of the create screen of one issue type. */
export interface JiraField {
  id: string;
  name: string;
  required: boolean;
  schema: {type: string; items?: string; system?: string; custom?: string};
  allowedValues?: JiraAllowedValue[];
  // Jira fills a required field with a default value by itself
  hasDefaultValue?: boolean;
}

export interface JiraUser {
  name?: string;
  key?: string;
  accountId?: string;
  displayName?: string;
}

export interface JiraParentIssue {
  key: string;
  summary: string;
  projectKey: string;
  assignee: JiraUser | null;
  // every field of the task, to copy what the bug needs from it
  fields: Record<string, unknown>;
}

/** An issue found by a search, with whether it is still open. */
export interface JiraFoundIssue {
  key: string;
  url: string;
  summary: string;
  status: string;
  // the status category is Done
  done: boolean;
  // the status category: new, indeterminate (in progress) or done
  category: string;
  labels: string[];
}

export interface JiraAttachment {
  fileName: string;
  content: Buffer;
  contentType: string;
}

/**
 * The Jira REST v2 calls needed to file a bug for a task. v2 takes wiki markup
 * in descriptions and is served by Cloud, Server and Data Center alike. Create
 * screens are read through the createmeta endpoints of Jira 8.4+ and 9, with
 * the older single createmeta call as a fallback.
 */
export class JiraClient {
  private readonly base: string;

  constructor(
    private readonly config: JiraConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = config.url.replace(/\/+$/, '');
  }

  private authHeader(): string {
    return this.config.email
      ? `Basic ${Buffer.from(`${this.config.email}:${this.config.token}`).toString('base64')}`
      : `Bearer ${this.config.token}`;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.base}${path}`, {
      ...init,
      headers: {Accept: 'application/json', Authorization: this.authHeader(), ...(init.headers ?? {})},
    });
    const text = await response.text();
    if (!response.ok) {
      let detail = text.slice(0, 300);
      try {
        const body = JSON.parse(text);
        detail = [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})].join('; ') || detail;
      } catch {
        // not JSON: keep the raw text
      }
      throw new JiraError(
        `Jira ${init.method ?? 'GET'} ${path} failed (${response.status}): ${detail}`,
        response.status,
      );
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private json(method: string, body: unknown): RequestInit {
    return {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)};
  }

  /** Vision Inspector: who the token belongs to, to check the connection. */
  async myself(): Promise<JiraUser> {
    return this.request<JiraUser>('/rest/api/2/myself');
  }

  /** A GET on the site with the token: the task context reads Jira and Confluence through it. */
  async get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  get site(): string {
    return this.base;
  }

  browseUrl(key: string): string {
    return `${this.base}/browse/${key}`;
  }

  async getIssue(key: string): Promise<JiraParentIssue> {
    const issue = await this.request<{key: string; fields: Record<string, unknown>}>(
      `/rest/api/2/issue/${encodeURIComponent(key)}`,
    );
    const fields = issue.fields ?? {};
    return {
      key: issue.key,
      summary: String(fields.summary ?? ''),
      projectKey: (fields.project as {key: string})?.key,
      assignee: (fields.assignee as JiraUser) ?? null,
      fields,
    };
  }

  /**
   * Every item of a paged createmeta list. Jira Cloud names the list
   * issueTypes or fields and pages by total; Data Center 9 names it values
   * and says isLast. At most 200 a page on both.
   */
  private async allPages<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    for (let startAt = 0; startAt < 10_000;) {
      const separator = path.includes('?') ? '&' : '?';
      const page = await this.request<Record<string, unknown>>(`${path}${separator}startAt=${startAt}&maxResults=200`);
      const list = (page.values ?? page.issueTypes ?? page.fields ?? page.results ?? []) as T[];
      items.push(...list);
      const total = typeof page.total === 'number' ? page.total : undefined;
      if (
        !list.length ||
        page.isLast === true ||
        (total !== undefined && items.length >= total) ||
        (total === undefined && page.isLast === undefined)
      ) {
        break;
      }
      startAt += list.length;
    }
    return items;
  }

  /** Issue types a project can create, sub-tasks included. */
  async issueTypes(projectKey: string): Promise<JiraIssueType[]> {
    type RawType = {id: string; name: string; subtask?: boolean};
    const pick = (types: RawType[]) =>
      types.map((type) => ({id: String(type.id), name: type.name, subtask: !!type.subtask}));
    try {
      return pick(
        await this.allPages<RawType>(`/rest/api/2/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`),
      );
    } catch (error) {
      if (!(error instanceof JiraError) || error.status !== 404) {
        throw error;
      }
      // Jira 8 before 8.4
      const meta = await this.request<{projects: Array<{issuetypes: RawType[]}>}>(
        `/rest/api/2/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}`,
      );
      return pick(meta.projects?.[0]?.issuetypes ?? []);
    }
  }

  /** Fields on the create screen of an issue type, with which of them are required. */
  async createFields(projectKey: string, issueTypeId: string): Promise<JiraField[]> {
    type RawField = Omit<JiraField, 'id'> & {fieldId?: string; key?: string};
    try {
      const fields = await this.allPages<RawField>(
        `/rest/api/2/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes/${encodeURIComponent(issueTypeId)}`,
      );
      return fields.map((field) => ({...field, id: field.fieldId ?? field.key}));
    } catch (error) {
      if (!(error instanceof JiraError) || error.status !== 404) {
        throw error;
      }
      const meta = await this.request<{
        projects: Array<{issuetypes: Array<{fields: Record<string, RawField>}>}>;
      }>(
        `/rest/api/2/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}&issuetypeIds=${encodeURIComponent(issueTypeId)}&expand=projects.issuetypes.fields`,
      );
      const fields = meta.projects?.[0]?.issuetypes?.[0]?.fields ?? {};
      return Object.entries(fields).map(([id, field]) => ({...field, id}));
    }
  }

  /** People matching a name, for user fields: accountId on Cloud, name on Server and Data Center. */
  async findUsers(query: string): Promise<JiraUser[]> {
    const body = await this.request<{users?: JiraUser[]}>(
      `/rest/api/2/user/picker?query=${encodeURIComponent(query)}&maxResults=20`,
    );
    return (body.users ?? []).map((user) => ({
      accountId: user.accountId,
      name: user.name,
      key: user.key,
      displayName: user.displayName,
    }));
  }

  /**
   * Issues matching a JQL query, newest first. Jira Cloud has the paged
   * search/jql endpoint (the old one is being removed); Server and Data Center
   * only the classic search.
   */
  async search(jql: string, max = 10, timeoutMs?: number): Promise<JiraFoundIssue[]> {
    type Found = {issues?: Array<{key: string; fields?: Record<string, unknown>}>};
    const query = `jql=${encodeURIComponent(jql)}&maxResults=${max}&fields=summary,status,labels`;
    const init = timeoutMs ? {signal: AbortSignal.timeout(timeoutMs)} : {};
    let found: Found;
    try {
      found = await this.request<Found>(`/rest/api/2/search/jql?${query}`, init);
    } catch (error) {
      if (!(error instanceof JiraError) || ![404, 405, 410].includes(error.status)) {
        throw error;
      }
      found = await this.request<Found>(`/rest/api/2/search?${query}`, init);
    }
    return (found.issues ?? []).map((issue) => {
      const status = (issue.fields?.status ?? {}) as {name?: string; statusCategory?: {key?: string}};
      return {
        key: issue.key,
        url: this.browseUrl(issue.key),
        summary: String(issue.fields?.summary ?? ''),
        status: status.name ?? '',
        done: status.statusCategory?.key === 'done',
        category: status.statusCategory?.key ?? '',
        labels: Array.isArray(issue.fields?.labels) ? (issue.fields.labels as string[]) : [],
      };
    });
  }

  async linkTypes(): Promise<JiraLinkType[]> {
    const body = await this.request<{issueLinkTypes: JiraLinkType[]}>('/rest/api/2/issueLinkType');
    return body.issueLinkTypes ?? [];
  }

  async createIssue(fields: Record<string, unknown>): Promise<{key: string; url: string}> {
    const created = await this.request<{key: string}>('/rest/api/2/issue', this.json('POST', {fields}));
    return {key: created.key, url: this.browseUrl(created.key)};
  }

  async link(typeName: string, inwardKey: string, outwardKey: string): Promise<void> {
    await this.request(
      '/rest/api/2/issueLink',
      this.json('POST', {
        type: {name: typeName},
        inwardIssue: {key: inwardKey},
        outwardIssue: {key: outwardKey},
      }),
    );
  }

  async assign(key: string, user: JiraUser): Promise<void> {
    await this.request(
      `/rest/api/2/issue/${encodeURIComponent(key)}/assignee`,
      this.json('PUT', user.accountId ? {accountId: user.accountId} : {name: user.name}),
    );
  }

  /** Adds and removes labels by editing the issue: for create screens without labels, and for markers. */
  async editLabels(key: string, change: {add?: string[]; remove?: string[]}): Promise<void> {
    const labels = [
      ...(change.add ?? []).map((label) => ({add: label})),
      ...(change.remove ?? []).map((label) => ({remove: label})),
    ];
    if (!labels.length) {
      return;
    }
    await this.request(`/rest/api/2/issue/${encodeURIComponent(key)}`, this.json('PUT', {update: {labels}}));
  }

  async attach(key: string, attachment: JiraAttachment): Promise<void> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(attachment.content)], {type: attachment.contentType}),
      attachment.fileName,
    );
    await this.request(`/rest/api/2/issue/${encodeURIComponent(key)}/attachments`, {
      method: 'POST',
      headers: {'X-Atlassian-Token': 'no-check'},
      body: form,
    });
  }
}
