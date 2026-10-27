import {
  IconArrowBackUp,
  IconBrain,
  IconBookmark,
  IconHistory,
  IconLoader2,
  IconPlayerStop,
  IconPlus,
  IconSend,
  IconTool,
  IconX,
} from '@tabler/icons-react';
import {App, Button, Dropdown, Input, Popover, Switch, Tag, Tooltip} from 'antd';
import {useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useSelector} from 'react-redux';

import {chatCredits} from '../../../shared/agent/acp-events.js';
import {approxTokens} from '../../../shared/agent/budget.js';
import {chip} from '../../../shared/agent/context.js';
import {formatCredits} from '../../../shared/agent/credits.js';
import {activeDevice} from '../../actions/Workstation.js';
import {
  addProposal,
  answerPermission,
  cancelTurn,
  confirmCredits,
  dismissNeeds,
  giveConsent,
  newConversation,
  openConversation,
  pastConversations,
  readMore,
  resumeConversation,
  sendMessage,
  toggleAgent,
  undoChange,
  undoTurn,
  useAgent,
} from '../../lib/agent/agent-store.js';
import {usePicks} from '../../lib/agent/selection.js';
import {useProfiles} from '../../lib/settings/profiles-store.js';
import {useTask} from '../../lib/task/task-store.js';
import {backend} from '../../polyfills.js';
import {useScreenHistory} from '../A11yTool/screen-history.js';
import GoalCard from '../Goals/GoalCard.jsx';
import AgentText from './AgentText.jsx';
import ConsentCard from './ConsentCard.jsx';
import MemoryCard from './MemoryCard.jsx';

import styles from './Agent.module.css';

const WIDTH_KEY = 'agentPanelWidth';
const readWidth = () => {
  try {
    return Number(localStorage.getItem(WIDTH_KEY)) || 420;
  } catch {
    return 420;
  }
};

const OPTION_LABEL = {
  allow_once: 'agentAllowOnce',
  allow_always: 'agentAllowAlways',
  reject_once: 'agentReject',
  reject_always: 'agentRejectAlways',
};

/** The chips of the next message: where the person is and what is picked. */
function useChips() {
  const {t} = useTranslation();
  const picks = usePicks();
  const profiles = useProfiles();
  const flow = useScreenHistory();
  const {current: taskKey, data: taskData} = useTask();
  const device = useSelector((state) => activeDevice(state.workstation));
  const app = useSelector((state) => state.workstation.app);
  const element = useSelector((state) => state.inspector?.selectedElement);
  return useMemo(() => {
    const profile = profiles.list.find((one) => one.id === profiles.activeId);
    const screen = flow.screens?.find((one) => one.key === flow.currentKey);
    const attrs = element?.attributes ?? {};
    return [
      picks.tab && chip('tab', picks.tab.id, t(`wsTool_${picks.tab.id}`, {defaultValue: picks.tab.id})),
      profile && chip('profile', profile.id, profile.name),
      taskKey && chip('task', taskKey, `${taskKey} ${taskData?.context?.task.summary ?? ''}`),
      device && chip('device', device.udid ?? device.id, device.name),
      app && chip('app', app.id, app.id),
      screen && chip('screen', screen.key, screen.title ?? screen.key),
      element &&
        chip(
          'element',
          element.path,
          attrs.text || attrs['content-desc'] || attrs.label || attrs.name || attrs['resource-id'] || element.tagName,
        ),
      picks.request && chip('request', picks.request.id, picks.request.label),
      picks.log && chip('log', picks.log.id, picks.log.label),
      picks.finding && chip('finding', picks.finding.id, picks.finding.label),
    ].filter(Boolean);
  }, [picks, profiles, taskKey, taskData, flow.screens, flow.currentKey, device, app, element, t]);
}

const ToolRow = ({item}) => {
  const {t} = useTranslation();
  const running = item.status === 'pending' || item.status === 'in_progress';
  return (
    <div className={`${styles.tool} ${item.status === 'failed' ? styles.toolFailed : ''}`}>
      {running ? <IconLoader2 size={14} className={styles.spin} /> : <IconTool size={14} />}
      <span className={styles.toolName}>{item.tool ?? item.title}</span>
      {item.server && item.server !== 'station' && <span className={styles.toolServer}>{item.server}</span>}
      {item.chars > 0 && <span className={styles.toolSize}>{t('agentTokens', {count: approxTokens(item.chars)})}</span>}
      {item.failure && (
        <span className={styles.toolServer}>{t(`agentToolFailure_${item.failure}`, {defaultValue: item.failure})}</span>
      )}
    </div>
  );
};

// the tags of a note started from a turn: what the person's message pointed at
const tagsOf = (chips = []) => ({
  screen: chips.find((one) => one.kind === 'screen')?.label,
  endpoint: chips.find((one) => one.kind === 'request')?.label,
  task: chips.find((one) => one.kind === 'task')?.id,
});

const TurnLine = ({item, turn, changes, language, notes, chips}) => {
  const {t} = useTranslation();
  const {modal} = App.useApp();
  const mine = changes.filter((change) => change.turn === turn);
  // a rollback asks why, to remember it as a correction
  const askWhy = (summary) =>
    addProposal({
      note: {kind: 'correction', scope: 'project', text: '', tags: tagsOf(chips)},
      hint: t('memoryWhyUndone', {change: summary}),
    });
  const undo = async (run, summary) => {
    const result = await run(false);
    if (result?.conflict) {
      modal.confirm({
        title: t('agentUndoConflictTitle'),
        content: t('agentUndoConflict'),
        okText: t('agentUndoAnyway'),
        okButtonProps: {danger: true},
        cancelText: t('Cancel'),
        onOk: async () => {
          await run(true);
          askWhy(summary);
        },
      });
    } else if (result?.ok) {
      askWhy(summary);
    }
  };
  return (
    <div className={styles.turn}>
      <span className={styles.turnRow}>
        {t('agentTurnCredits', {credits: formatCredits(item.credits, language)})}
        {item.ms ? ` · ${(item.ms / 1000).toFixed(1)} ${t('agentSeconds')}` : ''}
        {item.toolChars ? ` · ${t('agentTurnContext', {count: approxTokens(item.toolChars)})}` : ''}
        {notes?.length > 0 && (
          <Popover
            content={
              <ul className={styles.list}>
                {notes.map((note) => (
                  <li key={note.id}>{note.text}</li>
                ))}
              </ul>
            }
            title={t('memoryUsedTitle')}
          >
            <span className={styles.usedNotes}> · {t('memoryUsed', {count: notes.length})}</span>
          </Popover>
        )}
        <Button
          size="small"
          type="link"
          icon={<IconBookmark size={13} />}
          onClick={() => addProposal({note: {kind: 'lesson', scope: 'project', text: '', tags: tagsOf(chips)}})}
        >
          {t('memoryRemember')}
        </Button>
      </span>
      {mine.length > 0 && (
        <div className={styles.changes}>
          {mine.map((change) => (
            <div key={change.id} className={`${styles.change} ${change.undone ? styles.changeUndone : ''}`}>
              <span>{change.summary}</span>
              {!change.undone && (
                <Button
                  size="small"
                  type="link"
                  onClick={() => undo((force) => undoChange(change.id, force), change.summary)}
                >
                  {t('agentUndo')}
                </Button>
              )}
            </div>
          ))}
          {mine.filter((change) => !change.undone).length > 1 && (
            <Button
              size="small"
              icon={<IconArrowBackUp size={14} />}
              onClick={() => undo((force) => undoTurn(turn, force), mine.map((change) => change.summary).join('; '))}
            >
              {t('agentUndoTurn')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

const PermissionCard = ({request}) => {
  const {t} = useTranslation();
  const preview = request.preview;
  return (
    <div className={styles.card}>
      <b>{t('agentPermissionTitle', {tool: request.tool ?? request.title})}</b>
      {request.server && request.server !== 'station' && (
        <span className={styles.muted}>{t('agentPermissionServer', {server: request.server})}</span>
      )}
      {preview?.discard ? (
        <>
          <span>{t('agentPermissionCheckout', {repo: preview.repo, branch: preview.branch})}</span>
          {preview.discard.length > 0 ? (
            <>
              <span className={styles.warn}>
                {t('agentPermissionDiscard', {count: preview.discard.length + preview.more})}
              </span>
              <pre className={styles.code}>{preview.discard.join('\n')}</pre>
            </>
          ) : (
            <span className={styles.muted}>{t('settingsSourceSwitchClean')}</span>
          )}
        </>
      ) : (
        request.input && <pre className={styles.code}>{JSON.stringify(request.input, null, 1).slice(0, 1500)}</pre>
      )}
      <div className={styles.cardActions}>
        {request.options.map((option) => (
          <Button
            key={option.optionId}
            size="small"
            type={option.kind === 'allow_once' ? 'primary' : 'default'}
            danger={option.kind.startsWith('reject')}
            onClick={() => answerPermission(request.id, option.optionId)}
          >
            {OPTION_LABEL[option.kind] ? t(OPTION_LABEL[option.kind]) : option.name}
          </Button>
        ))}
      </div>
    </div>
  );
};

const ContextUsage = ({context}) => {
  const {t} = useTranslation();
  if (!context) {
    return null;
  }
  const parts = context.breakdown ?? {};
  const rows = [
    ['agentContext_files', parts.contextFiles?.tokens],
    ['agentContext_builtin', parts.tools?.builtin?.tokens],
    ['agentContext_mcp', parts.tools?.mcp?.tokens],
    ['agentContext_memory', parts.memory?.tokens],
    ['agentContext_prompts', parts.yourPrompts?.tokens],
    ['agentContext_responses', parts.kiroResponses?.tokens],
  ].filter(([, tokens]) => tokens !== undefined);
  const files = parts.contextFiles?.items ?? [];
  return (
    <Popover
      title={t('agentContextTitle')}
      content={
        <div className={styles.breakdown}>
          {rows.map(([key, tokens]) => (
            <div key={key}>
              <span>{t(key)}</span>
              <span>{tokens}</span>
            </div>
          ))}
          {files.map((file) => (
            <div key={file.uri} className={styles.muted}>
              <span>{file.name}</span>
              <span>{file.tokens}</span>
            </div>
          ))}
        </div>
      }
    >
      <span className={`${styles.context} ${context.percent > 60 ? styles.contextHigh : ''}`}>
        {t('agentContextPercent', {percent: Math.round(context.percent)})}
      </span>
    </Popover>
  );
};

/** The agent's chat: the same conversation whichever tab is open. */
const AgentPanel = () => {
  const {t, i18n} = useTranslation();
  const agent = useAgent();
  const chips = useChips();
  // a task's conversation is named after the task
  const {current: taskKey, data: taskData} = useTask();
  const [removed, setRemoved] = useState(new Set());
  const [text, setText] = useState('');
  const [deep, setDeep] = useState(false);
  const [width, setWidth] = useState(readWidth);
  const [past, setPast] = useState([]);
  const listRef = useRef(null);
  const language = i18n.language?.slice(0, 2) ?? 'uk';

  // the chip of «Ask the agent» joins the others until the message goes
  const allChips = useMemo(() => {
    const draft = agent.draft?.pick;
    const list =
      draft && !chips.some((one) => one.kind === draft.kind && one.id === draft.id)
        ? [...chips, chip(draft.kind, draft.id, draft.label)]
        : chips;
    return list.filter(Boolean).filter((one) => !removed.has(`${one.kind}:${one.id}`));
  }, [chips, agent.draft, removed]);

  const lastText = agent.chat.items.at(-1)?.text;
  useEffect(() => {
    listRef.current?.scrollTo({top: listRef.current.scrollHeight});
  }, [agent.chat.items.length, agent.permissions.length, lastText]);

  if (!agent.open) {
    return null;
  }

  const send = () => {
    if (!text.trim() || agent.status === 'busy') {
      return;
    }
    sendMessage(text, allChips, {deep});
    setText('');
    setRemoved(new Set());
    setDeep(false);
  };

  const startResize = (event) => {
    const startX = event.clientX;
    const startWidth = width;
    const move = (e) => setWidth(Math.min(900, Math.max(320, startWidth + (startX - e.clientX))));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setWidth((value) => {
        try {
          localStorage.setItem(WIDTH_KEY, String(value));
        } catch {
          // the width is not kept then
        }
        return value;
      });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const credits = chatCredits(agent.chat);
  const busy = agent.status === 'busy';

  return (
    <aside className={styles.panel} style={{width}} aria-label={t('agentTitle')}>
      <div className={styles.resize} onMouseDown={startResize} role="separator" aria-orientation="vertical" />
      <header className={styles.head}>
        <IconBrain size={18} className={styles.headIcon} />
        <div className={styles.headTitle}>
          <span className={styles.title}>
            {agent.chat.title ??
              (taskKey ? `${taskKey} · ${taskData?.context?.task.summary ?? ''}` : t('agentGeneral'))}
          </span>
          <span className={styles.muted}>
            {t('agentHeadCredits', {
              conversation: formatCredits(credits, language),
              today: formatCredits(agent.credits?.summary?.today ?? null, language),
            })}
          </span>
        </div>
        <ContextUsage context={agent.chat.context} />
        <Tooltip title={t('agentNew')}>
          <Button type="text" icon={<IconPlus size={16} />} onClick={newConversation} aria-label={t('agentNew')} />
        </Tooltip>
        <Dropdown
          trigger={['click']}
          onOpenChange={async (open) => open && setPast(await pastConversations())}
          menu={{
            items: past.length
              ? past.map((one) => ({
                  key: one.sessionId,
                  label: `${one.title ?? (one.key === '_general' ? t('agentGeneral') : one.key)} · ${new Date(one.updatedAt).toLocaleString()}`,
                }))
              : [{key: 'none', label: t('agentPastNone'), disabled: true}],
            onClick: ({key}) => key !== 'none' && resumeConversation(key),
          }}
        >
          <Tooltip title={t('agentPast')}>
            <Button type="text" icon={<IconHistory size={16} />} aria-label={t('agentPast')} />
          </Tooltip>
        </Dropdown>
        <Button
          type="text"
          icon={<IconX size={16} />}
          onClick={() => toggleAgent(false)}
          aria-label={t('agentClose')}
        />
      </header>

      <div className={styles.messages} ref={listRef}>
        {agent.status === 'starting' && (
          <div className={styles.center}>
            <IconLoader2 size={18} className={styles.spin} /> {t('agentStarting')}
          </div>
        )}
        {agent.status === 'error' && (
          <div className={styles.card}>
            <b>{t(`agentError_${agent.error}`, {defaultValue: t('agentError_other')})}</b>
            {agent.errorDetail && <code className={styles.detail}>{agent.errorDetail}</code>}
            <div className={styles.cardActions}>
              <Button size="small" onClick={() => openConversation()}>
                {t('agentRetry')}
              </Button>
            </div>
          </div>
        )}
        {agent.status !== 'starting' &&
          !agent.chat.items.length &&
          agent.status !== 'error' &&
          agent.consent !== false &&
          !agent.needs && <div className={styles.empty}>{t('agentEmpty')}</div>}
        {agent.chat.items.map((item) => {
          if (item.type === 'user') {
            return (
              <div key={item.id} className={styles.user}>
                {item.chips?.length > 0 && (
                  <div className={styles.userChips}>
                    {item.chips.map((one) => (
                      <span key={`${one.kind}:${one.id}`} className={styles.miniChip}>
                        {one.label}
                      </span>
                    ))}
                  </div>
                )}
                {/* a replayed message carries the reference block the station added */}
                <AgentText text={item.text.replace(/<station-context>[\s\S]*?<\/station-context>\s*/g, '')} />
              </div>
            );
          }
          if (item.type === 'agent') {
            return (
              <div key={item.id} className={styles.agent}>
                <AgentText text={item.text} />
              </div>
            );
          }
          if (item.type === 'tool') {
            return <ToolRow key={item.id} item={item} />;
          }
          if (item.type === 'turn') {
            const asked = agent.chat.items
              .slice(0, agent.chat.items.indexOf(item))
              .findLast((one) => one.type === 'user');
            return (
              <TurnLine
                key={item.id}
                item={item}
                turn={agent.turns[item.id]}
                changes={agent.changes}
                language={language}
                notes={agent.turnNotes[item.id]}
                chips={asked?.chips}
              />
            );
          }
          if (item.type === 'notice') {
            return (
              <div key={item.id} className={styles.notice}>
                {t('agentCompacted')}
              </div>
            );
          }
          return null;
        })}
        {agent.mcp
          .filter((server) => server.failedAuthorization)
          .map((server) => (
            <div key={`login-${server.name}`} className={styles.card}>
              <span>{t('agentMcpLoginNeeded', {name: server.name})}</span>
              <div className={styles.cardActions}>
                <Button
                  size="small"
                  type="primary"
                  onClick={() => backend.agent.mcpLogin(agent.sessionId, server.name)}
                >
                  {t('agentMcpLogin', {name: server.name})}
                </Button>
              </div>
            </div>
          ))}
        {agent.goalProposals.map((proposal) => (
          <GoalCard key={proposal.id} proposal={proposal} />
        ))}
        {agent.proposals.map((proposal) => (
          <MemoryCard key={proposal.id} proposal={proposal} />
        ))}
        {agent.permissions.map((request) => (
          <PermissionCard key={request.id} request={request} />
        ))}
        {agent.budget?.kind === 'budget' && (
          <div className={styles.card}>
            <span>{t('agentBudget', {count: agent.budget.used})}</span>
            <div className={styles.cardActions}>
              <Button
                size="small"
                type="primary"
                onClick={async () => {
                  await readMore();
                  if (!busy) {
                    sendMessage(t('agentReadMoreMessage'), []);
                  }
                }}
              >
                {t('agentReadMore')}
              </Button>
            </div>
          </div>
        )}
        {(agent.needs?.kind === 'consent' || (agent.consent === false && agent.status !== 'error')) && (
          <ConsentCard
            pending={agent.needs?.kind === 'consent'}
            onAllow={giveConsent}
            onCancel={agent.needs?.kind === 'consent' ? dismissNeeds : null}
          />
        )}
        {agent.needs?.kind === 'creditLimit' && (
          <div className={styles.card}>
            <span>{t('agentCreditLimit', {spent: formatCredits(Number(agent.needs.spent), language)})}</span>
            <div className={styles.cardActions}>
              <Button size="small" type="primary" onClick={confirmCredits}>
                {t('agentCreditContinue')}
              </Button>
              <Button size="small" onClick={dismissNeeds}>
                {t('Cancel')}
              </Button>
            </div>
          </div>
        )}
      </div>

      <footer className={styles.compose}>
        {allChips.length > 0 && (
          <div className={styles.chips}>
            {allChips.map((one) => (
              <Tag
                key={`${one.kind}:${one.id}`}
                closable
                onClose={() => setRemoved(new Set([...removed, `${one.kind}:${one.id}`]))}
                className={styles.chip}
              >
                <span className={styles.chipKind}>{t(`agentChip_${one.kind}`)}</span> {one.label}
              </Tag>
            ))}
          </div>
        )}
        <Input.TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          autoSize={{minRows: 2, maxRows: 8}}
          placeholder={t('agentPlaceholder')}
          disabled={agent.status === 'starting' || agent.status === 'error' || !agent.sessionId}
        />
        <div className={styles.composeBar}>
          <Tooltip title={t('agentDeepHint')}>
            <label className={styles.deep}>
              <Switch size="small" checked={deep} onChange={setDeep} /> {t('agentDeep')}
            </label>
          </Tooltip>
          {busy ? (
            <Button icon={<IconPlayerStop size={16} />} onClick={cancelTurn}>
              {t('agentStop')}
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<IconSend size={16} />}
              onClick={send}
              disabled={!text.trim() || !agent.sessionId}
            >
              {t('agentSend')}
            </Button>
          )}
        </div>
      </footer>
    </aside>
  );
};

export default AgentPanel;
