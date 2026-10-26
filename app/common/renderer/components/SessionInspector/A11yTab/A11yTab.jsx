import {
  IconAdjustmentsHorizontal,
  IconDots,
  IconListNumbers,
  IconRefresh,
  IconScan,
  IconSparkles,
} from '@tabler/icons-react';
import {Alert, Button, Dropdown, Empty, Segmented, Select, Space, Spin, Tag, Tooltip} from 'antd';
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {A11Y_RULES} from '../../../lib/a11y/types';
import {backend, openLink} from '../../../polyfills.js';
import {downloadText, pickFiles, readTextFromUploadedFiles} from '../../../utils/file-handling.js';
import {notification} from '../../../utils/notification.js';
import AiSettingsModal from '../../AiSettings/AiSettingsModal.jsx';
import JiraSettingsModal from '../../Jira/JiraSettingsModal.jsx';
import {a11yScore, problemAsText, problemsForScore, visibleIssues} from './a11y-ui.js';
import AiPanel from './AiPanel.jsx';
import DecisionModal from './DecisionModal.jsx';
import {buildHtmlReport} from './html-report.js';
import IssueCard from './IssueCard.jsx';
import JiraBugDialog from './JiraBugDialog.jsx';
import RulesModal from './RulesModal.jsx';
import ScoreRing from './ScoreRing.jsx';
import StressMenu from './StressMenu.jsx';

import styles from './A11yTab.module.css';

const STATUSES = ['open', 'reported', 'ignored', 'resolved'];

/**
 * The Accessibility tab: the screen checked against the rules, the issues
 * found, and what the team decided about each.
 */
const A11yTab = (props) => {
  const {
    sourceXML,
    screenshot,
    a11yStatus,
    a11yScan,
    a11yScreen,
    a11yDevice,
    a11yError,
    a11yHighlight,
    a11yOverlay,
    a11yFilter,
    a11yConfig,
    a11yIssues,
    a11yJiraLookup,
    a11yStress,
    endA11yStress,
    a11yAi,
    runA11yAi,
    loadA11ySettings,
    runA11yScan,
    refreshA11yScreen,
    methodCallInProgress,
    setA11yHighlight,
    setA11yOverlay,
    setA11yFilter,
    saveA11yConfig,
    recordA11yDecision,
    linkA11yProblem,
    forgetA11yDecision,
    importA11yDecisions,
    selectElement,
  } = props;
  const {t} = useTranslation();
  const [rulesOpen, setRulesOpen] = useState(false);
  const [decision, setDecision] = useState(null);
  const [bugFor, setBugFor] = useState(null);
  const [jiraOpen, setJiraOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const cardRefs = useRef(new Map());

  useEffect(() => {
    loadA11ySettings();
  }, [loadA11ySettings]);

  // every new source or screenshot is checked again
  useEffect(() => {
    if (sourceXML) {
      runA11yScan();
    }
  }, [sourceXML, screenshot, runA11yScan]);

  const {reviewed, visible} = useMemo(
    () => visibleIssues({a11yScan, a11yScreen, a11yDevice, a11yIssues, a11yFilter, a11yAi, a11yConfig}),
    [a11yScan, a11yScreen, a11yDevice, a11yIssues, a11yFilter, a11yAi, a11yConfig],
  );

  // the overlay scrolls the list to the issue clicked on the screenshot
  useEffect(() => {
    const card = a11yHighlight && cardRefs.current.get(a11yHighlight);
    card?.scrollIntoView({behavior: 'smooth', block: 'nearest'});
  }, [a11yHighlight]);

  if (!sourceXML) {
    return <Empty description={t('a11yNoSource')} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const shownByStatus = {
    open: reviewed?.open ?? [],
    reported: reviewed?.reported ?? [],
    ignored: reviewed?.ignored ?? [],
    resolved: [],
  };
  const score = a11yScore(problemsForScore(reviewed));
  const counts = {
    open: reviewed?.summary.open ?? 0,
    reported: reviewed?.summary.reported ?? 0,
    ignored: reviewed?.summary.ignored ?? 0,
    resolved: reviewed?.summary.resolved ?? 0,
  };
  const severityCounts = (reviewed?.open ?? []).reduce(
    (acc, v) => ({...acc, [v.severity]: (acc[v.severity] ?? 0) + 1}),
    {error: 0, warning: 0, info: 0},
  );
  const rulesPresent = new Set(shownByStatus[a11yFilter.status].map((group) => group.rule));

  const copy = async (group) => {
    await navigator.clipboard.writeText(problemAsText(t, group, a11yScreen));
    notification.success({title: t('a11yCopied'), duration: 2});
  };

  const confirmDecision = async (value) => {
    const {kind, group} = decision;
    setDecision(null);
    if (kind === 'link') {
      await linkA11yProblem(group, value);
    } else {
      await recordA11yDecision(group, {status: 'ignored', comment: value || null});
    }
  };

  const exportDecisions = () => downloadText('vision-a11y-decisions.json', JSON.stringify(a11yIssues ?? {}, null, 2));

  const importDecisions = async () => {
    const [file] = await readTextFromUploadedFiles(await pickFiles());
    if (!file) {
      return;
    }
    try {
      await importA11yDecisions(JSON.parse(file.content));
      notification.success({title: t('a11yDecisionsImported')});
    } catch {
      notification.error({title: t('a11ySettingsInvalidFile')});
    }
  };

  const exportReport = () => {
    const html = buildHtmlReport({
      t,
      scan: a11yScan,
      reviewed,
      screen: a11yScreen,
      device: a11yDevice,
      screenshot,
      score,
    });
    const name = (a11yScreen?.title ?? 'screen').replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60);
    downloadText(`a11y-${name}.html`, html, 'text/html');
  };

  const moreItems = [
    {key: 'report', label: t('a11yReportExport'), onClick: exportReport},
    {key: 'jira', label: t('jiraSettings'), onClick: () => setJiraOpen(true)},
    {key: 'ai', label: t('aiSettings'), onClick: () => setAiOpen(true)},
    {type: 'divider'},
    {key: 'export', label: t('a11yDecisionsExport'), onClick: exportDecisions},
    {key: 'import', label: t('a11yDecisionsImport'), onClick: importDecisions},
  ];

  return (
    <div className={styles.a11yTab}>
      <motion.div
        className={styles.summary}
        initial={{opacity: 0, y: 8}}
        animate={{opacity: 1, y: 0}}
        transition={{duration: 0.45, ease: [0.22, 1, 0.36, 1]}}
      >
        <ScoreRing score={reviewed ? score : 0} label={t('a11yScore')} />
        <div className={styles.summaryText}>
          <div className={styles.screenLabel}>{t('a11yScreen')}</div>
          <div className={styles.screenTitle}>{a11yScreen?.title ?? t('a11yScreenUnknown')}</div>
          <div className={styles.screenMeta}>
            {a11yScreen && <span>{t(`a11yScreenSource_${a11yScreen.source}`)}</span>}
            {a11yDevice?.appId && <code>{a11yDevice.appId}</code>}
            {a11yJiraLookup?.status === 'running' && (
              <span className={styles.jiraLookup}>
                <IconRefresh size={12} className={styles.spinning} />
                {t('a11yCheckingJira')}
              </span>
            )}
          </div>
          <div className={styles.severityChips}>
            {['error', 'warning', 'info'].map((severity) => (
              <button
                key={severity}
                type="button"
                className={`${styles.severityChip} ${styles[`chip_${severity}`]} ${a11yFilter.severity === severity ? styles.chipActive : ''}`}
                onClick={() => setA11yFilter({severity: a11yFilter.severity === severity ? 'all' : severity})}
              >
                <motion.span
                  key={severityCounts[severity]}
                  initial={{scale: 1.4, opacity: 0}}
                  animate={{scale: 1, opacity: 1}}
                >
                  {severityCounts[severity]}
                </motion.span>
                {t(`a11ySeverity_${severity}`)}
              </button>
            ))}
          </div>
        </div>
        <Space orientation="vertical" size={6} className={styles.summaryActions}>
          <Space size={6} wrap>
            {backend.ai && (
              <Button
                className={styles.aiButton}
                icon={<IconSparkles size={16} />}
                loading={a11yAi?.status === 'running'}
                onClick={() => runA11yAi()}
              >
                {t('aiCheck')}
              </Button>
            )}
            <Button
              type="primary"
              icon={
                <IconRefresh
                  size={16}
                  className={a11yStatus === 'scanning' || methodCallInProgress ? styles.spinning : ''}
                />
              }
              onClick={() => refreshA11yScreen()}
            >
              {t('a11yRescan')}
            </Button>
          </Space>
          <Space size={6} wrap>
            <Tooltip title={t('a11yOverlayIssues')}>
              <Button
                type={a11yOverlay.issues ? 'primary' : 'default'}
                ghost={a11yOverlay.issues}
                icon={<IconScan size={16} />}
                onClick={() => setA11yOverlay({issues: !a11yOverlay.issues})}
              />
            </Tooltip>
            <Tooltip title={t('a11yOverlayReadingOrder')}>
              <Button
                type={a11yOverlay.readingOrder ? 'primary' : 'default'}
                ghost={a11yOverlay.readingOrder}
                icon={<IconListNumbers size={16} />}
                onClick={() => setA11yOverlay({readingOrder: !a11yOverlay.readingOrder})}
              />
            </Tooltip>
            <Tooltip title={t('a11ySettings')}>
              <Button icon={<IconAdjustmentsHorizontal size={16} />} onClick={() => setRulesOpen(true)} />
            </Tooltip>
            <StressMenu {...props} />
            <Dropdown menu={{items: moreItems}} trigger={['click']}>
              <Button icon={<IconDots size={16} />} aria-label={t('a11yMore')} />
            </Dropdown>
          </Space>
        </Space>
      </motion.div>

      {a11yStatus === 'error' && <Alert type="error" showIcon title={t('a11yScanFailed', {error: a11yError})} />}

      <AnimatePresence>
        {a11yStress && (
          <motion.div
            className={styles.stressBanner}
            initial={{opacity: 0, height: 0}}
            animate={{opacity: 1, height: 'auto'}}
            exit={{opacity: 0, height: 0}}
          >
            <Alert
              type="warning"
              showIcon
              title={t('a11yStressActive', {mode: t(`a11yStress_${a11yStress.mode}`)})}
              action={
                <Button size="small" onClick={() => endA11yStress()}>
                  {t('a11yStressRestore')}
                </Button>
              }
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AiPanel {...props} onOpenSettings={() => setAiOpen(true)} />

      <div className={styles.filters}>
        <Segmented
          value={a11yFilter.status}
          onChange={(status) => setA11yFilter({status})}
          options={STATUSES.map((status) => ({
            value: status,
            label: (
              <span className={styles.statusOption}>
                {t(`a11yStatus_${status}`)}
                <span className={styles.statusCount}>{counts[status]}</span>
              </span>
            ),
          }))}
        />
        <Select
          size="middle"
          value={a11yFilter.rule}
          onChange={(rule) => setA11yFilter({rule})}
          popupMatchSelectWidth={false}
          className={styles.ruleSelect}
          options={[
            {value: 'all', label: t('a11yRuleAll')},
            ...A11Y_RULES.filter((rule) => rulesPresent.has(rule)).map((rule) => ({
              value: rule,
              label: t(`a11yRule_${rule}`),
            })),
          ]}
        />
      </div>

      <Spin spinning={a11yStatus === 'scanning' && !reviewed} tip={t('a11yScanning')}>
        <div className={styles.issueList}>
          {a11yFilter.status === 'resolved' ? (
            <ResolvedList resolved={reviewed?.resolved ?? []} />
          ) : (
            <AnimatePresence mode="popLayout">
              {visible.map((group, index) => (
                <IssueCard
                  key={group.key}
                  ref={(el) => (el ? cardRefs.current.set(group.key, el) : cardRefs.current.delete(group.key))}
                  index={index}
                  group={group}
                  highlighted={a11yHighlight === group.key}
                  underStress={!!a11yStress && group.violations.some((v) => !a11yStress.baselineIds.includes(v.id))}
                  onHover={setA11yHighlight}
                  onShow={(g) => selectElement(g.violations[0].elementPath)}
                  onIgnore={(g) => setDecision({kind: 'ignore', group: g})}
                  onLink={(g) => setDecision({kind: 'link', group: g})}
                  onFileBug={(g) => setBugFor(g)}
                  onUndo={(g) => forgetA11yDecision(g)}
                  onCopy={copy}
                />
              ))}
            </AnimatePresence>
          )}
          {reviewed && a11yFilter.status !== 'resolved' && visible.length === 0 && (
            <EmptyState allClear={reviewed.summary.open === 0 && a11yFilter.status === 'open'} />
          )}
        </div>
      </Spin>

      <DecisionModal decision={decision} onCancel={() => setDecision(null)} onConfirm={confirmDecision} />
      <RulesModal
        open={rulesOpen}
        config={a11yConfig}
        onClose={() => setRulesOpen(false)}
        onSave={async (config) => {
          setRulesOpen(false);
          await saveA11yConfig(config);
          notification.success({title: t('a11ySettingsSaved'), duration: 2});
        }}
      />
      <JiraBugDialog {...props} group={bugFor} onClose={() => setBugFor(null)} />
      <JiraSettingsModal open={jiraOpen} onClose={() => setJiraOpen(false)} />
      <AiSettingsModal open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  );
};

const EmptyState = ({allClear}) => {
  const {t} = useTranslation();
  return (
    <motion.div
      className={styles.emptyState}
      initial={{opacity: 0, scale: 0.96}}
      animate={{opacity: 1, scale: 1}}
      transition={{duration: 0.5, ease: [0.22, 1, 0.36, 1]}}
    >
      <div className={`${styles.emptyGlyph} ${allClear ? styles.emptyGlyphGood : ''}`}>{allClear ? '✓' : '∅'}</div>
      <div className={styles.emptyTitle}>{allClear ? t('a11yAllClear') : t('a11yNothingFound')}</div>
      {!allClear && <div className={styles.emptyHint}>{t('a11yNothingFoundHint')}</div>}
    </motion.div>
  );
};

const ResolvedList = ({resolved}) => {
  const {t} = useTranslation();
  if (!resolved.length) {
    return <EmptyState allClear={false} />;
  }
  return resolved.map((problem) => (
    <motion.div
      key={problem.code}
      className={`${styles.issueCard} ${styles.sev_resolved}`}
      layout
      initial={{opacity: 0}}
      animate={{opacity: 1}}
    >
      <div className={styles.issueHead}>
        <div className={styles.issueTitle}>
          {t(`a11yRule_${problem.facets[0]?.rule}`, {defaultValue: problem.facets[0]?.rule ?? ''})}
        </div>
        {problem.jiraKey && (
          <Tag color="green" className={styles.jiraTag} onClick={() => problem.jiraUrl && openLink(problem.jiraUrl)}>
            {problem.jiraKey}
          </Tag>
        )}
      </div>
      <div className={styles.problemMeta}>
        <code className={styles.problemCode}>{problem.code}</code>
        {problem.facets[0]?.component && <span className={styles.problemChip}>{problem.facets[0].component}</span>}
      </div>
      <div className={styles.issueNote}>{t('a11yResolvedHint')}</div>
    </motion.div>
  ));
};

export default A11yTab;
