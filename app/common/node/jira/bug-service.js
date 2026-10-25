import {buildBugFields, defaultIssueType, inspectorBugText} from '../../renderer/lib/a11y/jira-bug';
import {JiraClient, JiraError} from './client';

// The team's defaults, as in vision: every accessibility bug is S4 (scale S1–S5, SC)
export const DEFAULT_JIRA_SETTINGS = {
  url: '',
  email: '',
  issueType: '',
  linkType: '',
  severity: 'S4',
  labels: ['accessibility', 'vision'],
};

const message = (error) => (error instanceof JiraError ? error.message : String(error?.message ?? error));

/**
 * Files Vision Inspector's accessibility bugs in Jira the way vision does
 * (A11yIssuesService.prepareBug / fileBug): under a task, as its sub-task or
 * linked to it, with the task's assignee and required fields copied, and the
 * screenshot with the element outlined attached.
 */
export class JiraBugService {
  constructor({getSettings, getToken, fetchImpl = fetch}) {
    this.getSettings = getSettings;
    this.getToken = getToken;
    this.fetchImpl = fetchImpl;
  }

  async client() {
    const settings = {...DEFAULT_JIRA_SETTINGS, ...(await this.getSettings())};
    const token = await this.getToken();
    if (!settings.url || !settings.email || !token) {
      throw new Error('Jira is not set up: add the site, your email and an API token in the Jira settings');
    }
    return {jira: new JiraClient({url: settings.url, email: settings.email, token}, this.fetchImpl), settings};
  }

  async test() {
    try {
      const {jira} = await this.client();
      const me = await jira.myself();
      return {ok: true, user: me.displayName ?? me.accountId};
    } catch (error) {
      return {ok: false, error: message(error)};
    }
  }

  async findUsers(query) {
    const {jira} = await this.client();
    return await jira.findUsers(query);
  }

  async issue(key) {
    const {jira} = await this.client();
    const issue = await jira.getIssue(key.trim().toUpperCase());
    return {key: issue.key, summary: issue.summary, url: jira.browseUrl(issue.key)};
  }

  text(request) {
    return inspectorBugText({
      violation: request.violation,
      block: request.block,
      screen: request.screen,
      device: request.device,
      app: request.app,
      locator: request.locator,
      suggestedLabel: request.suggestedLabel,
    });
  }

  /**
   * What filing would do: issue and link types of the task's project, the one
   * offered first, the fields filled in and the ones still to choose.
   */
  async prepare(request) {
    try {
      const {jira, settings} = await this.client();
      const parent = await jira.getIssue(request.parentKey.trim().toUpperCase());
      const [issueTypes, linkTypes] = await Promise.all([
        jira.issueTypes(parent.projectKey),
        jira.linkTypes().catch(() => []),
      ]);
      const chosen =
        (request.issueTypeId && issueTypes.find((type) => type.id === request.issueTypeId)) ||
        defaultIssueType(issueTypes, settings.issueType);
      if (!chosen) {
        return {ok: false, error: `Project ${parent.projectKey} offers no issue type to create`};
      }
      const text = this.text(request);
      const bug = buildBugFields({
        meta: await jira.createFields(parent.projectKey, chosen.id),
        parent,
        issueType: chosen,
        summary: text.summary,
        description: text.description,
        labels: settings.labels,
        severity: settings.severity,
        overrides: request.fieldValues,
      });
      const defaultLink =
        linkTypes.find((type) => settings.linkType && type.name.toLowerCase() === settings.linkType.toLowerCase()) ??
        linkTypes.find((type) => /relat|связ|пов.яз/i.test(type.name)) ??
        linkTypes[0];
      return {
        ok: true,
        parent: {
          key: parent.key,
          summary: parent.summary,
          projectKey: parent.projectKey,
          assignee: parent.assignee?.displayName ?? null,
        },
        issueTypes,
        issueTypeId: chosen.id,
        linkTypes: linkTypes.map((type) => type.name),
        linkType: defaultLink?.name ?? null,
        summary: text.summary,
        description: text.description,
        filled: bug.filled,
        inputs: bug.inputs,
        missing: bug.missing,
      };
    } catch (error) {
      return {ok: false, error: message(error)};
    }
  }

  /**
   * Creates the bug, links or assigns it as needed and attaches the screenshot.
   */
  async file(request) {
    try {
      const {jira, settings} = await this.client();
      const parent = await jira.getIssue(request.parentKey.trim().toUpperCase());
      const issueTypes = await jira.issueTypes(parent.projectKey);
      const issueType =
        (request.issueTypeId && issueTypes.find((type) => type.id === request.issueTypeId)) ||
        defaultIssueType(issueTypes, settings.issueType);
      if (!issueType) {
        return {ok: false, error: `Project ${parent.projectKey} offers no issue type to create`};
      }
      const text = this.text(request);
      const bug = buildBugFields({
        meta: await jira.createFields(parent.projectKey, issueType.id),
        parent,
        issueType,
        summary: text.summary,
        description: text.description,
        labels: settings.labels,
        severity: settings.severity,
        overrides: request.fieldValues,
      });
      if (bug.missing.length) {
        return {
          ok: false,
          error: `Jira requires fields that are still empty for "${issueType.name}": ${bug.missing.join(', ')}.`,
        };
      }
      const issue = await jira.createIssue(bug.fields);
      const warnings = [];
      if (!issueType.subtask) {
        const linkType = request.linkType || settings.linkType || 'Relates';
        await jira.link(linkType, issue.key, parent.key).catch((error) => {
          warnings.push(`Not linked to ${parent.key}: ${message(error)}`);
        });
      }
      if (bug.assignAfter) {
        await jira.assign(issue.key, bug.assignAfter).catch((error) => {
          warnings.push(`Not assigned: ${message(error)}`);
        });
      }
      if (request.screenshotPng) {
        await jira
          .attach(issue.key, {
            fileName: `${(request.screen || request.block || 'screen').replace(/[^\p{L}\p{N}.-]+/gu, '_').slice(0, 80)}-a11y.png`,
            content: Buffer.from(request.screenshotPng, 'base64'),
            contentType: 'image/png',
          })
          .catch((error) => {
            warnings.push(`Screenshot not attached: ${message(error)}`);
          });
      }
      return {ok: true, key: issue.key, url: issue.url, warnings};
    } catch (error) {
      return {ok: false, error: message(error)};
    }
  }
}
