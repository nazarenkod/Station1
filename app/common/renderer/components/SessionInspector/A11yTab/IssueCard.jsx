import {
  IconAlertTriangle,
  IconBug,
  IconBulb,
  IconCircleX,
  IconCopy,
  IconEyeOff,
  IconFocus2,
  IconInfoCircle,
  IconLink,
  IconArrowBackUp,
  IconSparkles,
  IconStack2,
} from '@tabler/icons-react';
import {Button, Tag, Tooltip} from 'antd';
import {motion} from 'motion/react';
import {forwardRef} from 'react';
import {useTranslation} from 'react-i18next';

import {openLink} from '../../../polyfills.js';
import {violationText} from './a11y-ui.js';

import styles from './A11yTab.module.css';

const SEVERITY_ICON = {
  error: IconCircleX,
  warning: IconAlertTriangle,
  info: IconInfoCircle,
};

const Swatch = ({color}) => <span className={styles.swatch} style={{background: color}} title={color} />;

/**
 * Numbers that make the issue concrete: the two colours and their ratio, the
 * size against the minimum.
 */
const IssueFacts = ({violation}) => {
  const {t} = useTranslation();
  const d = violation.details ?? {};
  if (d.foreground && d.background) {
    return (
      <div className={styles.facts}>
        <span className={styles.contrastPair}>
          <Swatch color={d.foreground} />
          <Swatch color={d.background} />
          <span>{t('a11yContrastPair', {foreground: d.foreground, background: d.background})}</span>
        </span>
        <span className={`${styles.factPill} ${styles.factBad}`}>
          {d.ratio} : 1 <span className={styles.factMuted}>/ {d.required}</span>
        </span>
      </div>
    );
  }
  if (d.widthDp !== undefined) {
    return (
      <div className={styles.facts}>
        <span className={`${styles.factPill} ${styles.factBad}`}>
          {d.widthDp} × {d.heightDp} {d.unit}
        </span>
        <span className={styles.factPill}>
          min {d.min} × {d.min} {d.unit}
        </span>
        {d.estimatedDensity && (
          <Tooltip title={t('a11yEstimatedDensity')}>
            <span className={styles.factMuted}>≈</span>
          </Tooltip>
        )}
      </div>
    );
  }
  return null;
};

// the elements of a problem listed on its card before "and N more"
const SHOWN_ELEMENTS = 3;

/**
 * One accessibility problem: the same rule on one or more elements (of one
 * component, or of one screen), with its id and what can be done about it.
 */
const IssueCard = forwardRef(function IssueCard(
  {group, highlighted, underStress, onHover, onShow, onIgnore, onLink, onFileBug, onUndo, onCopy, index},
  ref,
) {
  const {t} = useTranslation();
  const [first] = group.violations;
  const {title, fix} = violationText(t, first);
  const messages = group.violations.map((violation) => violationText(t, violation).message);
  const issue = group.issue;
  const SeverityIcon = SEVERITY_ICON[group.severity];
  const suggested = group.violations.find((violation) => violation.details?.suggestedLabel)?.details.suggestedLabel;

  return (
    <motion.div
      ref={ref}
      layout
      initial={{opacity: 0, y: 12, scale: 0.98}}
      animate={{opacity: 1, y: 0, scale: 1}}
      exit={{opacity: 0, x: 40, scale: 0.96, transition: {duration: 0.25}}}
      transition={{duration: 0.4, delay: Math.min(index, 12) * 0.03, ease: [0.22, 1, 0.36, 1]}}
      className={`${styles.issueCard} ${styles[`sev_${group.severity}`]} ${highlighted ? styles.issueHighlighted : ''}`}
      onMouseEnter={() => onHover(group.key)}
      onMouseLeave={() => onHover(null)}
    >
      <div className={styles.issueHead}>
        <SeverityIcon size={18} className={styles.severityIcon} />
        <div className={styles.issueTitle}>{title}</div>
        {underStress && (
          <Tag color="orange" className={styles.aiTag}>
            {t('a11yUnderStress')}
          </Tag>
        )}
        {first.source === 'ai' && (
          <Tag className={styles.aiTag} icon={<IconSparkles size={12} />}>
            {t('a11ySourceAi')}
          </Tag>
        )}
        {issue?.status === 'reported' && issue.jiraKey && (
          <Tag
            color="purple"
            className={styles.jiraTag}
            onClick={() => issue.jiraUrl && openLink(issue.jiraUrl)}
            icon={<IconBug size={12} />}
          >
            {issue.jiraKey}
          </Tag>
        )}
      </div>
      <div className={styles.problemMeta}>
        <Tooltip title={t('a11yProblemIdHint')}>
          <code className={styles.problemCode}>{group.code}</code>
        </Tooltip>
        {group.component && (
          <Tooltip title={group.everyScreen ? t('a11yEveryScreenHint') : null}>
            <span className={styles.problemChip}>
              {group.everyScreen && <IconStack2 size={12} />}
              {group.component}
            </span>
          </Tooltip>
        )}
        {group.problemClass && <span className={styles.problemChip}>{group.problemClass}</span>}
        {group.violations.length > 1 && (
          <span className={styles.problemChip}>{t('a11yElements', {count: group.violations.length})}</span>
        )}
      </div>
      {group.violations.length === 1 ? (
        <div className={styles.issueMessage}>{messages[0]}</div>
      ) : (
        <ul className={styles.problemElements}>
          {messages.slice(0, SHOWN_ELEMENTS).map((message, i) => (
            <li key={group.violations[i].id}>{message}</li>
          ))}
          {messages.length > SHOWN_ELEMENTS && (
            <li>{t('a11yMoreElements', {count: messages.length - SHOWN_ELEMENTS})}</li>
          )}
        </ul>
      )}
      <IssueFacts violation={first} />
      {issue?.decidedOn && (
        <div className={styles.issueNote}>
          <IconStack2 size={14} />
          {issue.status === 'reported'
            ? t('a11yFiledOnScreen', {screen: issue.decidedOn})
            : t('a11yIgnoredOnScreen', {screen: issue.decidedOn})}
        </div>
      )}
      {issue?.comment === 'Found in Jira' && (
        <div className={styles.issueNote}>
          <IconBug size={14} />
          {t('a11yFoundInJiraNote')}
        </div>
      )}
      {issue?.related?.length > 0 && (
        <div className={styles.issueNote}>
          <IconBug size={14} />
          {t('a11yRelatedBugs', {bugs: issue.related.map((bug) => bug.jiraKey ?? bug.code).join(', ')})}
        </div>
      )}
      {issue?.status === 'ignored' && !issue.decidedOn && (
        <div className={styles.issueNote}>
          <IconEyeOff size={14} />
          {issue.byClass
            ? t('a11yIgnoredByClass', {name: issue.byClass})
            : issue.comment
              ? t('a11yIgnoredBecause', {comment: issue.comment})
              : t('a11yIgnoredNoReason')}
        </div>
      )}
      {suggested && (
        <div className={styles.suggestion}>
          <IconSparkles size={14} />
          <span>
            {t('aiSuggestedLabel')} <strong>“{suggested}”</strong>
          </span>
        </div>
      )}
      {fix && !issue && (
        <div className={styles.issueFix}>
          <IconBulb size={14} />
          <span>{fix}</span>
        </div>
      )}
      <div className={styles.issueActions}>
        {first.elementPath !== undefined && (
          <Button size="small" type="text" icon={<IconFocus2 size={14} />} onClick={() => onShow(group)}>
            {t('a11yShowElement')}
          </Button>
        )}
        {!issue && (
          <>
            <Button size="small" type="primary" icon={<IconBug size={14} />} onClick={() => onFileBug(group)}>
              {t('a11yFileBug')}
            </Button>
            <Tooltip title={t('a11yLinkJira')}>
              <Button size="small" type="text" icon={<IconLink size={14} />} onClick={() => onLink(group)} />
            </Tooltip>
            <Tooltip title={t('a11yIgnore')}>
              <Button size="small" type="text" icon={<IconEyeOff size={14} />} onClick={() => onIgnore(group)} />
            </Tooltip>
          </>
        )}
        {issue && !issue.byClass && (
          <Tooltip title={issue.status === 'reported' ? t('a11yUnlinkHint') : null}>
            <Button size="small" type="text" icon={<IconArrowBackUp size={14} />} onClick={() => onUndo(group)}>
              {issue.status === 'reported' ? t('a11yUnlink') : t('a11yUndo')}
            </Button>
          </Tooltip>
        )}
        <Tooltip title={t('a11yCopy')}>
          <Button size="small" type="text" icon={<IconCopy size={14} />} onClick={() => onCopy(group)} />
        </Tooltip>
      </div>
    </motion.div>
  );
});

export default IssueCard;
