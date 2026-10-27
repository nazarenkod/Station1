import {
  IconBookmark,
  IconBrain,
  IconDots,
  IconExternalLink,
  IconListCheck,
  IconRefresh,
  IconSearch,
  IconSwitchHorizontal,
  IconTarget,
  IconThumbDown,
  IconThumbUp,
  IconTrash,
} from '@tabler/icons-react';
import {Button, Checkbox, Dropdown, Input, Modal, Popover, Spin, Tabs, Tag, Tooltip} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useNavigate} from 'react-router';

import {formatCredits} from '../../../shared/agent/credits.js';
import {SECTIONS} from '../../../shared/task/impact.js';
import {wikiBlocks} from '../../../shared/task/jira-wiki.js';
import {addProposal, askOnTask} from '../../lib/agent/agent-store.js';
import {openGoalForm} from '../../lib/goals/goal-form.js';
import {
  chooseTask,
  forgetCurrentTask,
  giveFeedback,
  refreshTask,
  toggleCheck,
  useTask,
} from '../../lib/task/task-store.js';
import {openLink} from '../../polyfills.js';

import styles from './TaskPanel.module.css';

const Link = ({url, children}) => (
  <button type="button" className={styles.link} onClick={() => openLink(url)}>
    {children} <IconExternalLink size={12} />
  </button>
);

const Evidence = ({item}) => {
  const {t} = useTranslation();
  return (
    <div className={styles.why}>
      {item.why && <p>{item.why}</p>}
      <span className={styles.dim}>{t('taskEvidence')}</span>
      <ul>
        {item.evidence.map((one) => (
          <li key={`${one.file ?? ''}${one.lines ?? ''}${one.commit ?? ''}${one.mr ?? ''}`}>
            {one.file && (
              <code>
                {one.file}
                {one.lines ? `:${one.lines}` : ''}
              </code>
            )}
            {one.commit && <code> {one.commit.slice(0, 10)}</code>}
            {one.mr && <Link url={one.mr}>MR</Link>}
            {one.note && <span className={styles.dim}> — {one.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
};

const NoiseButton = ({item, current, taskKey}) => {
  const {t} = useTranslation();
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      title={t('taskNoiseWhy')}
      content={
        <div className={styles.noise}>
          <Input.TextArea value={reason} onChange={(e) => setReason(e.target.value)} autoSize={{minRows: 2}} />
          <Button
            size="small"
            type="primary"
            onClick={() => {
              giveFeedback(item.id, 'noise', reason);
              setOpen(false);
              // the reason becomes a correction of the project, for the next analyses
              addProposal({
                note: {
                  kind: 'correction',
                  scope: 'project',
                  text: t('memoryNoiseText', {item: item.text, reason}).slice(0, 300),
                  tags: {task: taskKey},
                },
              });
            }}
          >
            {t('taskNoiseSave')}
          </Button>
        </div>
      }
    >
      <Tooltip title={t('taskNoise')}>
        <Button
          size="small"
          type="text"
          icon={<IconThumbDown size={14} />}
          className={current === 'noise' ? styles.on : ''}
          aria-label={t('taskNoise')}
        />
      </Tooltip>
    </Popover>
  );
};

const Checklist = ({data, language}) => {
  const {t} = useTranslation();
  const impact = data.impact;
  const fresh = new Set(impact.changes?.added ?? []);
  return (
    <div className={styles.impact}>
      <div className={styles.impactHead}>
        <b>{t('taskImpact')}</b>
        <span className={styles.dim}>
          {new Date(impact.at).toLocaleString()}
          {impact.credits !== null && impact.credits !== undefined
            ? ` · ${t('taskImpactCredits', {credits: formatCredits(impact.credits, language)})}`
            : ''}
        </span>
        {impact.stale && (
          <Tag color="warning" className={styles.tag}>
            {t('taskImpactStale')}
          </Tag>
        )}
      </div>
      {SECTIONS.map((section) => {
        const items = impact.items.filter((item) => item.section === section);
        return (
          <div key={section} className={styles.section}>
            <span className={styles.sectionTitle}>{t(`taskImpact_${section}`)}</span>
            {!items.length && <span className={styles.dim}>{impact.empty?.[section] ?? t('taskImpactNothing')}</span>}
            {items.map((item) => (
              <div key={item.id} className={styles.item}>
                <Checkbox checked={!!data.checks?.[item.id]} onChange={(e) => toggleCheck(item.id, e.target.checked)} />
                {item.important && <span className={styles.important}>!</span>}
                <span className={`${styles.itemText} ${data.checks?.[item.id] ? styles.done : ''}`}>{item.text}</span>
                {fresh.has(item.id) && impact.changes && <Tag className={styles.tag}>{t('taskImpactNew')}</Tag>}
                <Tooltip title={t('goalMake')}>
                  <Button
                    size="small"
                    type="text"
                    icon={<IconTarget size={14} />}
                    aria-label={t('goalMake')}
                    onClick={() => openGoalForm({title: item.text, source: 'impact', itemId: item.id, type: 'manual'})}
                  />
                </Tooltip>
                <Popover content={<Evidence item={item} />} trigger="click" placement="left">
                  <Button size="small" type="link">
                    {t('taskWhy')}
                  </Button>
                </Popover>
                <Tooltip title={t('taskUseful')}>
                  <Button
                    size="small"
                    type="text"
                    icon={<IconThumbUp size={14} />}
                    className={data.feedback?.[item.id]?.kind === 'useful' ? styles.on : ''}
                    onClick={() => giveFeedback(item.id, 'useful')}
                    aria-label={t('taskUseful')}
                  />
                </Tooltip>
                <NoiseButton item={item} current={data.feedback?.[item.id]?.kind} taskKey={data.key} />
              </div>
            ))}
          </div>
        );
      })}
      {impact.changes?.removed?.length > 0 && (
        <span className={styles.dim}>{t('taskImpactRemoved', {count: impact.changes.removed.length})}</span>
      )}
    </div>
  );
};

// a status coloured by its Jira category: to do, in progress, done
const STATUS_COLOR = {new: 'default', indeterminate: 'processing', done: 'success'};

/** A description or comment of Jira: its markup as headings, lists, links and code. */
const JiraText = ({text}) => {
  const blocks = wikiBlocks(text);
  const inline = (parts) =>
    parts.map((part) =>
      part.url ? (
        <Link key={part.at} url={part.url}>
          {part.text}
        </Link>
      ) : part.bold ? (
        <b key={part.at}>{part.text}</b>
      ) : (
        <span key={part.at}>{part.text}</span>
      ),
    );
  return (
    <div className={styles.wiki}>
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === 'heading') {
          return (
            <p key={key} className={styles.wikiHeading}>
              {inline(block.parts)}
            </p>
          );
        }
        if (block.type === 'item') {
          return (
            <p key={key} className={styles.wikiItem} data-level={Math.min(block.level, 3)}>
              {inline(block.parts)}
            </p>
          );
        }
        if (block.type === 'code') {
          return (
            <pre key={key} className={styles.wikiCode}>
              {block.text}
            </pre>
          );
        }
        if (block.type === 'rule') {
          return <hr key={key} className={styles.wikiRule} />;
        }
        return <p key={key}>{inline(block.parts)}</p>;
      })}
    </div>
  );
};

const Row = ({children, aside}) => (
  <div className={styles.row}>
    <div className={styles.rowMain}>{children}</div>
    {aside && <div className={styles.rowAside}>{aside}</div>}
  </div>
);

/** The context of the task, a tab each: what it says, what it links to, what changed. */
const ContextTabs = ({context}) => {
  const {t} = useTranslation();
  const navigate = useNavigate();
  const gitlabOff = context.mrs.some((mr) => mr.skipped === 'gitlabNotSetUp');
  const items = [
    {
      key: 'description',
      label: t('taskTab_description'),
      children: context.task.description ? (
        <JiraText text={context.task.description} />
      ) : (
        <span className={styles.dim}>{t('taskNoDescription')}</span>
      ),
    },
    context.linked.length > 0 && {
      key: 'linked',
      label: t('taskTab_linked', {count: context.linked.length}),
      children: context.linked.map((one) => (
        <Row key={one.key} aside={<Tag color={STATUS_COLOR[one.statusCategory] ?? 'default'}>{one.status}</Tag>}>
          <span className={styles.relation}>{one.relation}</span>
          <b className={styles.mono}>{one.key}</b>
          <span className={styles.rowText}>{one.summary}</span>
        </Row>
      )),
    },
    context.pages.length > 0 && {
      key: 'pages',
      label: t('taskTab_pages', {count: context.pages.length}),
      children: context.pages.map((page) => (
        <Row key={page.id ?? page.url} aside={page.space && <span className={styles.dim}>{page.space}</span>}>
          <Link url={page.url}>{page.title ?? page.url}</Link>
          {page.skipped && <span className={styles.dim}>{t(`taskSkipped_${page.skipped}`)}</span>}
        </Row>
      )),
    },
    {
      key: 'mrs',
      label: t('taskTab_mrs', {count: context.mrs.length}),
      children: (
        <>
          {gitlabOff && (
            <div className={styles.notice}>
              {t('taskGitlabOff')}
              <Button
                size="small"
                type="link"
                onClick={() => navigate('/settings', {state: {section: 'integrations'}})}
              >
                {t('taskConnectGitlab')}
              </Button>
            </div>
          )}
          {!context.mrs.length && <span className={styles.dim}>{t('taskNoMrs')}</span>}
          {context.mrs.map((mr) => (
            <Row
              key={mr.url}
              aside={
                mr.skipped ? null : (
                  <Tag color={mr.state === 'merged' ? 'success' : mr.state === 'opened' ? 'processing' : 'default'}>
                    {mr.state}
                  </Tag>
                )
              }
            >
              <Link url={mr.url}>!{mr.iid}</Link>
              <span className={styles.rowText}>{mr.title ?? mr.project}</span>
              {!mr.skipped && (
                <span className={styles.dim}>
                  {mr.sourceBranch} → {mr.targetBranch} · {t('taskFiles', {count: mr.files.length})}
                </span>
              )}
              {mr.skipped && mr.skipped !== 'gitlabNotSetUp' && (
                <span className={styles.dim}>{t(`taskSkipped_${mr.skipped}`)}</span>
              )}
            </Row>
          ))}
        </>
      ),
    },
    context.commits.length > 0 && {
      key: 'commits',
      label: t('taskTab_commits', {count: context.commits.length}),
      children: context.commits.map((commit) => (
        <Row key={commit.sha}>
          <code className={styles.mono}>{commit.sha.slice(0, 8)}</code>
          <span className={styles.rowText}>{commit.subject}</span>
        </Row>
      )),
    },
    context.problems.length > 0 && {
      key: 'problems',
      label: t('taskTab_problems', {count: context.problems.length}),
      children: context.problems.map((one) => (
        <Row key={one.source}>
          <span className={styles.mono}>{one.source}</span>
          <span className={styles.warn}>{t(`taskProblem_${one.error}`)}</span>
        </Row>
      )),
    },
  ].filter(Boolean);
  return <Tabs size="small" items={items} className={styles.tabs} />;
};

/** Picking a task: by key or link, or one of the recent ones. */
const TaskPicker = ({onPicked, autoFocus = false}) => {
  const {t} = useTranslation();
  const navigate = useNavigate();
  const task = useTask();
  const [input, setInput] = useState('');
  const pick = async (value) => {
    if (value.trim() && (await chooseTask(value))) {
      setInput('');
      onPicked?.();
    }
  };
  const recent = task.recent.filter((key) => key !== task.current);
  return (
    <div className={styles.picker}>
      <div className={styles.pickerRow}>
        <Input
          size="large"
          value={input}
          autoFocus={autoFocus}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={() => pick(input)}
          placeholder={t('taskPlaceholder')}
          prefix={<IconSearch size={16} className={styles.dimIcon} />}
          allowClear
        />
        <Button size="large" type="primary" onClick={() => pick(input)} disabled={!input.trim()}>
          {t('taskPick')}
        </Button>
      </div>
      {recent.length > 0 && (
        <div className={styles.recent}>
          <span className={styles.dim}>{t('taskRecent')}</span>
          {recent.map((key) => (
            <Tag key={key} className={styles.recentTag} onClick={() => pick(key)}>
              {key}
            </Tag>
          ))}
        </div>
      )}
      {task.error && (
        <div className={styles.error}>
          {t(`taskError_${task.error.error}`, {defaultValue: t('taskError_failed')})}
          {task.error.error === 'jiraNotSetUp' && (
            <Button size="small" type="link" onClick={() => navigate('/settings', {state: {section: 'integrations'}})}>
              {t('taskSetUpJira')}
            </Button>
          )}
          {task.error.detail && <code className={styles.detail}>{task.error.detail}</code>}
        </div>
      )}
    </div>
  );
};

/**
 * The task the person works on. Without one: what to pick. With one: the
 * task itself, its two main actions, its context in tabs, the impact
 * checklist; the rarer actions wait in the menu.
 */
const TaskPanel = () => {
  const {t, i18n} = useTranslation();
  const task = useTask();
  const [changing, setChanging] = useState(false);
  const language = i18n.language?.slice(0, 2) ?? 'uk';
  const context = task.data?.context;

  if (!task.current) {
    return (
      <section className={`vi-panel ${styles.panel} ${styles.empty}`} aria-label={t('taskTitle')}>
        <IconTarget size={28} className={styles.emptyIcon} />
        <h2 className={styles.emptyTitle}>{t('taskEmptyTitle')}</h2>
        <p className={styles.dim}>{t('taskEmptyText')}</p>
        <TaskPicker autoFocus />
      </section>
    );
  }

  const issue = context?.task;
  const meta = issue ? [issue.type, issue.assignee, ...(issue.fixVersions ?? [])].filter(Boolean) : [];
  const menu = [
    {key: 'change', label: t('taskChange'), icon: <IconSwitchHorizontal size={15} />},
    {key: 'lessons', label: t('memorySummarize'), icon: <IconBookmark size={15} />, disabled: !context},
    {key: 'open', label: t('taskOpenJira'), icon: <IconExternalLink size={15} />, disabled: !context},
    {type: 'divider'},
    {key: 'forget', label: t('taskForget'), icon: <IconTrash size={15} />, danger: true},
  ];
  const onMenu = ({key}) => {
    if (key === 'change') {
      setChanging(true);
    } else if (key === 'lessons') {
      askOnTask(t('memorySummarizePrompt', {key: task.current}));
    } else if (key === 'open') {
      openLink(context.url);
    } else if (key === 'forget') {
      forgetCurrentTask();
    }
  };

  return (
    <section className={`vi-panel ${styles.panel}`} aria-label={t('taskTitle')}>
      <div className={styles.head}>
        <div className={styles.headMain}>
          <div className={styles.headLine}>
            <IconTarget size={18} className={styles.icon} />
            <button type="button" className={styles.key} onClick={() => context && openLink(context.url)}>
              {task.current}
            </button>
            {issue?.status && <Tag color={STATUS_COLOR[issue.statusCategory] ?? 'processing'}>{issue.status}</Tag>}
            {task.loading && <Spin size="small" />}
          </div>
          <h2 className={styles.title}>{issue?.summary ?? (task.loading ? t('taskLoading') : task.current)}</h2>
          {meta.length > 0 && <div className={styles.meta}>{meta.join(' · ')}</div>}
        </div>
        <div className={styles.headActions}>
          <Tooltip title={t('taskRefresh')}>
            <Button type="text" icon={<IconRefresh size={17} />} onClick={refreshTask} aria-label={t('taskRefresh')} />
          </Tooltip>
          <Dropdown menu={{items: menu, onClick: onMenu}} trigger={['click']} placement="bottomRight">
            <Button type="text" icon={<IconDots size={17} />} aria-label={t('taskMore')} />
          </Dropdown>
        </div>
      </div>

      {task.error && !context && (
        <div className={styles.error}>
          {t(`taskError_${task.error.error}`, {defaultValue: t('taskError_failed')})}
          {task.error.detail && <code className={styles.detail}>{task.error.detail}</code>}
        </div>
      )}

      {context && (
        <div className={styles.actions}>
          <Button
            type={task.data?.impact && !task.data.impact.stale ? 'default' : 'primary'}
            icon={<IconListCheck size={16} />}
            onClick={() => askOnTask(t('taskImpactPrompt', {key: task.current}), {deep: true})}
          >
            {task.data?.impact ? t('taskImpactAgain') : t('taskImpactRun')}
          </Button>
          <Button icon={<IconBrain size={16} />} onClick={() => askOnTask(t('taskAskPrompt', {key: task.current}))}>
            {t('taskAsk')}
          </Button>
        </div>
      )}

      {context && <ContextTabs context={context} />}
      {task.data?.impact && <Checklist data={task.data} language={language} />}

      <Modal open={changing} title={t('taskChange')} footer={null} onCancel={() => setChanging(false)} destroyOnHidden>
        <TaskPicker autoFocus onPicked={() => setChanging(false)} />
      </Modal>
    </section>
  );
};

export default TaskPanel;
