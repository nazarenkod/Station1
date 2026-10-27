import {
  IconBrain,
  IconChevronDown,
  IconChevronUp,
  IconExternalLink,
  IconRefresh,
  IconTarget,
  IconThumbDown,
  IconThumbUp,
  IconTrash,
} from '@tabler/icons-react';
import {AutoComplete, Button, Checkbox, Input, Popover, Spin, Tag, Tooltip} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useNavigate} from 'react-router';

import {formatCredits} from '../../../shared/agent/credits.js';
import {SECTIONS} from '../../../shared/task/impact.js';
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

const Details = ({context}) => {
  const {t} = useTranslation();
  return (
    <div className={styles.details}>
      <div className={styles.section}>
        <span className={styles.sectionTitle}>{t('taskSection_task')}</span>
        <span>
          {[context.task.type, context.task.status, context.task.assignee, context.task.fixVersions?.join(', ')]
            .filter(Boolean)
            .join(' · ')}
        </span>
        {context.task.description && <p className={styles.description}>{context.task.description.slice(0, 600)}</p>}
      </div>
      {context.linked.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionTitle}>{t('taskSection_linked')}</span>
          {context.linked.map((one) => (
            <span key={one.key}>
              <span className={styles.dim}>{one.relation}</span> <b>{one.key}</b> {one.summary}{' '}
              <span className={styles.dim}>· {one.status}</span>
            </span>
          ))}
        </div>
      )}
      {context.pages.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionTitle}>{t('taskSection_pages')}</span>
          {context.pages.map((page) => (
            <span key={page.id ?? page.url}>
              <Link url={page.url}>{page.title ?? page.url}</Link>
              {page.skipped && <span className={styles.dim}> — {t(`taskSkipped_${page.skipped}`)}</span>}
            </span>
          ))}
        </div>
      )}
      <div className={styles.section}>
        <span className={styles.sectionTitle}>{t('taskSection_mrs')}</span>
        {!context.mrs.length && <span className={styles.dim}>{t('taskNoMrs')}</span>}
        {context.mrs.map((mr) => (
          <span key={mr.url}>
            <Link url={mr.url}>{mr.title ?? `!${mr.iid}`}</Link>
            {mr.skipped ? (
              <span className={styles.dim}> — {t(`taskSkipped_${mr.skipped}`)}</span>
            ) : (
              <span className={styles.dim}>
                {' '}
                · {mr.state} · {mr.sourceBranch} → {mr.targetBranch} · {t('taskFiles', {count: mr.files.length})}
              </span>
            )}
          </span>
        ))}
      </div>
      {context.commits.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionTitle}>{t('taskSection_commits', {count: context.commits.length})}</span>
          {context.commits.slice(0, 5).map((commit) => (
            <span key={commit.sha} className={styles.dim}>
              <code>{commit.sha.slice(0, 8)}</code> {commit.subject}
            </span>
          ))}
        </div>
      )}
      {context.problems.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionTitle}>{t('taskSection_problems')}</span>
          {context.problems.map((one) => (
            <span key={one.source} className={styles.warn}>
              {one.source}: {t(`taskProblem_${one.error}`)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * The task the person works on: picked by key or link, its context from
 * Jira, Confluence and GitLab, and the impact analysis as a checklist.
 */
const TaskPanel = () => {
  const {t, i18n} = useTranslation();
  const navigate = useNavigate();
  const task = useTask();
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const language = i18n.language?.slice(0, 2) ?? 'uk';
  const context = task.data?.context;

  const pick = async (value) => {
    if (await chooseTask(value)) {
      setInput('');
    }
  };

  const summary = context
    ? [
        context.task.summary,
        context.task.status,
        t('taskCountLinked', {count: context.linked.length}),
        t('taskCountPages', {count: context.pages.length}),
        t('taskCountMrs', {count: context.mrs.length}),
      ].join(' · ')
    : null;

  return (
    <section className={`vi-panel ${styles.panel}`} aria-label={t('taskTitle')}>
      <div className={styles.head}>
        <IconTarget size={18} className={styles.icon} />
        {task.current ? (
          <>
            <button type="button" className={styles.key} onClick={() => context && openLink(context.url)}>
              {task.current}
            </button>
            <span className={styles.summary}>{task.loading ? t('taskLoading') : summary}</span>
            {task.loading && <Spin size="small" />}
            <Tooltip title={t('taskRefresh')}>
              <Button
                type="text"
                size="small"
                icon={<IconRefresh size={16} />}
                onClick={refreshTask}
                aria-label={t('taskRefresh')}
              />
            </Tooltip>
            {context && (
              <Button
                type="text"
                size="small"
                icon={open ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                onClick={() => setOpen(!open)}
                aria-label={t('taskDetails')}
              />
            )}
          </>
        ) : (
          <span className={styles.summary}>{t('taskNone')}</span>
        )}
        <AutoComplete
          value={input}
          onChange={setInput}
          onSelect={pick}
          options={task.recent.filter((key) => key !== task.current).map((key) => ({value: key, label: key}))}
          className={styles.input}
        >
          <Input
            placeholder={t('taskPlaceholder')}
            onPressEnter={() => input.trim() && pick(input)}
            allowClear
            size="small"
          />
        </AutoComplete>
        <Button size="small" onClick={() => input.trim() && pick(input)} disabled={!input.trim()}>
          {t('taskPick')}
        </Button>
      </div>
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
      {context && (
        <div className={styles.actions}>
          <Button
            size="small"
            icon={<IconBrain size={14} />}
            onClick={() => askOnTask(t('taskAskPrompt', {key: task.current}))}
          >
            {t('taskAsk')}
          </Button>
          <Button
            size="small"
            type={task.data?.impact && !task.data.impact.stale ? 'default' : 'primary'}
            onClick={() => askOnTask(t('taskImpactPrompt', {key: task.current}), {deep: true})}
          >
            {task.data?.impact ? t('taskImpactAgain') : t('taskImpactRun')}
          </Button>
          <Button size="small" onClick={() => askOnTask(t('memorySummarizePrompt', {key: task.current}))}>
            {t('memorySummarize')}
          </Button>
          <span className={styles.spacer} />
          <Button size="small" type="text" danger icon={<IconTrash size={14} />} onClick={forgetCurrentTask}>
            {t('taskForget')}
          </Button>
        </div>
      )}
      {open && context && <Details context={context} />}
      {task.data?.impact && <Checklist data={task.data} language={language} />}
    </section>
  );
};

export default TaskPanel;
