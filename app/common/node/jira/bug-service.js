import {buildBugFields, defaultIssueType, inspectorBugText} from '../../renderer/lib/a11y/jira-bug';
import {BUG_LABELS, codeOn, isBugOf, JIRA_LOOKUP_BATCH, jqlFor} from '../../renderer/lib/a11y/jira-problems';
import {isVisionMarker, unlinkedLabel} from '../../renderer/lib/a11y/problems';
import {JiraClient, JiraError} from './client';

// The team's defaults, as in vision: every accessibility bug is S4 (scale S1–S5, SC)
export const DEFAULT_JIRA_SETTINGS = {
  url: '',
  email: '',
  issueType: '',
  linkType: '',
  severity: 'S4',
  labels: BUG_LABELS,
};

const JIRA_LOOKUP_TIMEOUT_MS = 5000;

const message = (error) => (error instanceof JiraError ? error.message : String(error?.message ?? error));

/**
 * Files Vision Inspector's accessibility bugs in Jira the way vision does
 * (A11yIssuesService): one bug per problem, under a task, as its sub-task or
 * linked to it, with the task's assignee and required fields copied, the
 * problem's id in the summary and its markers as labels, and the screenshot
 * with the elements outlined.
 *
 * Vision has a database to claim a problem before filing; here Jira is the
 * only thing the team shares. So Jira is searched for the problem's id and
 * markers right before filing (an open bug is linked instead), the screen's
 * problems are looked up after each check, and a bug a colleague filed at
 * the same moment is reported as a likely duplicate.
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

  /**
   * The latest bugs the account reported, for the workstation's desk.
   */
  async mine(max = 8) {
    try {
      const {jira} = await this.client();
      return {ok: true, issues: await jira.search('reporter = currentUser() ORDER BY updated DESC', max)};
    } catch (error) {
      return {ok: false, error: message(error)};
    }
  }

  async findUsers(query) {
    const {jira} = await this.client();
    return await jira.findUsers(query);
  }

  text(request) {
    return inspectorBugText({
      violations: request.violations,
      problem: request.problem,
      block: request.block,
      screen: request.screen,
      device: request.device,
      app: request.app,
      locators: request.locators,
      suggestedLabel: request.suggestedLabel,
    });
  }

  labels(settings, problem) {
    return [...new Set([...(settings.labels ?? BUG_LABELS), ...problem.markers])];
  }

  /** Bugs in the Jira project with the problem's id or markers that are still its bugs, or done. */
  async findInJira(jira, projectKey, problem, unlinkedKeys = []) {
    const issues = await jira.search(
      `project = "${projectKey}" AND (${jqlFor(problem.code, problem.markerQuery)}) ORDER BY created DESC`,
      10,
    );
    return issues.filter(
      (issue) => !unlinkedKeys.includes(issue.key) && (issue.done || isBugOf(issue, problem.code, problem.markerQuery)),
    );
  }

  /**
   * What filing would do: issue and link types of the task's project, the
   * fields filled in and still to choose, the bug's text and markers, and the
   * problem's bugs Jira has already.
   */
  async prepare(request) {
    try {
      const {jira, settings} = await this.client();
      const parent = await jira.getIssue(request.parentKey.trim().toUpperCase());
      const [issueTypes, linkTypes, inJira] = await Promise.all([
        jira.issueTypes(parent.projectKey),
        jira.linkTypes().catch(() => []),
        this.findInJira(jira, parent.projectKey, request.problem, request.unlinkedKeys).catch(() => []),
      ]);
      const chosen =
        (request.issueTypeId && issueTypes.find((type) => type.id === request.issueTypeId)) ||
        defaultIssueType(issueTypes, settings.issueType);
      if (!chosen) {
        return {ok: false, error: `Project ${parent.projectKey} offers no issue type to create`};
      }
      const text = this.text(request);
      const labels = this.labels(settings, request.problem);
      const bug = buildBugFields({
        meta: await jira.createFields(parent.projectKey, chosen.id),
        parent,
        issueType: chosen,
        summary: text.summary,
        description: text.description,
        labels,
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
        markers: request.problem.markers,
        inJira,
      };
    } catch (error) {
      return {ok: false, error: message(error)};
    }
  }

  /**
   * Files the bug, unless Jira has an open one for the problem already: that
   * one is linked instead and gets the markers. After creating, Jira is asked
   * again, so a bug a colleague filed in the same moment is not missed.
   */
  async file(request) {
    try {
      const {jira, settings} = await this.client();
      const {problem} = request;
      const parent = await jira.getIssue(request.parentKey.trim().toUpperCase());
      const warnings = [];
      const found = await this.findInJira(jira, parent.projectKey, problem, request.unlinkedKeys).catch((error) => {
        warnings.push(`Could not check Jira for ${problem.code}: ${message(error)}`);
        return [];
      });
      const open = found.find((issue) => !issue.done);
      if (open) {
        const warning = await this.mirror(jira, open.key, 'linked', problem.code, problem.markers);
        return {
          ok: true,
          key: open.key,
          url: open.url,
          code: codeOn(open) ?? problem.code,
          alreadyFiled: true,
          warnings: [
            `Jira has ${open.key} (${open.status}) for ${problem.code}: linked instead of filing a new one`,
            ...(warning ? [warning] : []),
          ],
        };
      }
      if (found.length) {
        warnings.push(`${problem.code} was filed before as ${found.map((issue) => issue.key).join(', ')} (done)`);
      }

      const issueTypes = await jira.issueTypes(parent.projectKey);
      const issueType =
        (request.issueTypeId && issueTypes.find((type) => type.id === request.issueTypeId)) ||
        defaultIssueType(issueTypes, settings.issueType);
      if (!issueType) {
        return {ok: false, error: `Project ${parent.projectKey} offers no issue type to create`};
      }
      const text = this.text(request);
      const labels = this.labels(settings, problem);
      const bug = buildBugFields({
        meta: await jira.createFields(parent.projectKey, issueType.id),
        parent,
        issueType,
        summary: text.summary,
        description: text.description,
        labels,
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
      if (!bug.fields.labels) {
        // the create screen has no labels: the problem id is still in the summary
        await jira.editLabels(issue.key, {add: labels}).catch((error) => {
          warnings.push(`Labels not set (the id is in the summary): ${message(error)}`);
        });
      }
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
      // nothing claims a problem across machines: a bug filed by someone else meanwhile shows up here
      const others = await jira
        .search(`labels = "${problem.code}" AND key != "${issue.key}" ORDER BY created DESC`, 5)
        .then((issues) => issues.filter((other) => !other.done))
        .catch(() => []);
      return {
        ok: true,
        key: issue.key,
        url: issue.url,
        code: problem.code,
        alreadyFiled: false,
        duplicates: others.map((other) => ({key: other.key, url: other.url})),
        warnings,
      };
    } catch (error) {
      return {ok: false, error: message(error)};
    }
  }

  /**
   * Looks the screen's open problems up in Jira, in a few queries, by their
   * ids or markers: a bug filed by hand, from vision, from another Vision
   * Inspector or under other settings is found. Bugs unlinked from the
   * problem are left alone.
   */
  async lookup({items, unlinkedKeys = []}) {
    try {
      const {jira} = await this.client();
      const found = [];
      for (let start = 0; start < items.length; start += JIRA_LOOKUP_BATCH) {
        const batch = items.slice(start, start + JIRA_LOOKUP_BATCH);
        const jql = batch.map((item) => `(${jqlFor(item.code, item.markerQuery)})`).join(' OR ');
        const issues = await jira.search(`(${jql}) ORDER BY created DESC`, 100, JIRA_LOOKUP_TIMEOUT_MS);
        for (const item of batch) {
          const issue = issues.find(
            (candidate) => !unlinkedKeys.includes(candidate.key) && isBugOf(candidate, item.code, item.markerQuery),
          );
          if (issue) {
            found.push({group: item.group, code: codeOn(issue) ?? item.code, key: issue.key, url: issue.url});
          }
        }
      }
      return {ok: true, found};
    } catch (error) {
      return {ok: false, error: message(error)};
    }
  }

  /** Puts the problem's markers on a bug it is linked to, or takes them off and marks it unlinked. */
  async mirror(jira, jiraKey, change, code, markers) {
    try {
      if (change === 'linked') {
        await jira.editLabels(jiraKey, {add: markers, remove: [unlinkedLabel(code)]});
      } else {
        const issue = (await jira.search(`key = "${jiraKey}"`, 1))[0];
        const ours = (issue?.labels ?? []).filter(isVisionMarker);
        await jira.editLabels(jiraKey, {remove: ours, add: [unlinkedLabel(code)]});
      }
      return null;
    } catch (error) {
      return `Jira labels of ${jiraKey} not updated: ${message(error)}`;
    }
  }

  /** Links an existing bug to a problem: checks it exists and puts the markers on it. */
  async link({jiraKey, code, markers}) {
    try {
      const {jira} = await this.client();
      const issue = await jira.getIssue(jiraKey.trim().toUpperCase());
      const warning = await this.mirror(jira, issue.key, 'linked', code, markers);
      return {ok: true, key: issue.key, url: jira.browseUrl(issue.key), warnings: warning ? [warning] : []};
    } catch (error) {
      return {ok: false, error: message(error)};
    }
  }

  /** Unlinks a bug: no lookup links it to the problem again until someone links it by hand. */
  async unlink({jiraKey, code}) {
    try {
      const {jira} = await this.client();
      const warning = await this.mirror(jira, jiraKey, 'unlinked', code, []);
      return {ok: !warning, warnings: warning ? [warning] : []};
    } catch (error) {
      return {ok: false, error: message(error)};
    }
  }
}
