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

/**
 * One accessibility issue, with what can be done about it.
 */
const IssueCard = forwardRef(function IssueCard(
  {violation, highlighted, underStress, onHover, onShow, onIgnore, onLink, onFileBug, onUndo, onCopy, index},
  ref,
) {
  const {t} = useTranslation();
  const {title, message, fix} = violationText(t, violation);
  const issue = violation.issue;
  const SeverityIcon = SEVERITY_ICON[violation.severity];

  return (
    <motion.div
      ref={ref}
      layout
      initial={{opacity: 0, y: 12, scale: 0.98}}
      animate={{opacity: 1, y: 0, scale: 1}}
      exit={{opacity: 0, x: 40, scale: 0.96, transition: {duration: 0.25}}}
      transition={{duration: 0.4, delay: Math.min(index, 12) * 0.03, ease: [0.22, 1, 0.36, 1]}}
      className={`${styles.issueCard} ${styles[`sev_${violation.severity}`]} ${highlighted ? styles.issueHighlighted : ''}`}
      onMouseEnter={() => onHover(violation.id)}
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
        {violation.source === 'ai' && (
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
      <div className={styles.issueMessage}>{message}</div>
      <IssueFacts violation={violation} />
      {issue?.status === 'ignored' && (
        <div className={styles.issueNote}>
          <IconEyeOff size={14} />
          {issue.comment ? t('a11yIgnoredBecause', {comment: issue.comment}) : t('a11yIgnoredNoReason')}
        </div>
      )}
      {fix && !issue && (
        <div className={styles.issueFix}>
          <IconBulb size={14} />
          <span>{fix}</span>
        </div>
      )}
      <div className={styles.issueActions}>
        {violation.elementPath !== undefined && (
          <Button size="small" type="text" icon={<IconFocus2 size={14} />} onClick={() => onShow(violation)}>
            {t('a11yShowElement')}
          </Button>
        )}
        {!issue && (
          <>
            <Button size="small" type="primary" icon={<IconBug size={14} />} onClick={() => onFileBug(violation)}>
              {t('a11yFileBug')}
            </Button>
            <Tooltip title={t('a11yLinkJira')}>
              <Button size="small" type="text" icon={<IconLink size={14} />} onClick={() => onLink(violation)} />
            </Tooltip>
            <Tooltip title={t('a11yIgnore')}>
              <Button size="small" type="text" icon={<IconEyeOff size={14} />} onClick={() => onIgnore(violation)} />
            </Tooltip>
          </>
        )}
        {issue && (
          <Button size="small" type="text" icon={<IconArrowBackUp size={14} />} onClick={() => onUndo(violation)}>
            {t('a11yUndo')}
          </Button>
        )}
        <Tooltip title={t('a11yCopy')}>
          <Button size="small" type="text" icon={<IconCopy size={14} />} onClick={() => onCopy(violation)} />
        </Tooltip>
      </div>
    </motion.div>
  );
});

export default IssueCard;
