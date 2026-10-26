import {IconChevronDown, IconCircleCheck} from '@tabler/icons-react';
import {AnimatePresence, motion} from 'motion/react';
import {useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {SEVERITIES, severityRank} from '../../../shared/findings/findings.js';
import {EASE_OUT} from '../AppShell/motion.jsx';

import styles from './Findings.module.css';

export const SeverityTag = ({severity}) => {
  const {t} = useTranslation();
  return <span className={`${styles.severity} ${styles[`sev_${severity}`]}`}>{t(`findingSeverity_${severity}`)}</span>;
};

/**
 * One rule and everything that broke it: what is wrong, why it matters, how
 * to fix it, and the evidence for each subject.
 */
const FindingGroup = ({rule, items}) => {
  const {t} = useTranslation();
  const [open, setOpen] = useState(false);
  const [first] = items;
  const key = first.textKey ?? rule;
  // a rule may count for itself (permissions in one finding); otherwise the group size
  const params = {count: items.length, ...first.params};

  return (
    <li className={styles.group}>
      <button className={styles.groupHead} onClick={() => setOpen(!open)} aria-expanded={open}>
        <SeverityTag severity={first.severity} />
        <span className={styles.groupText}>
          <span className={styles.groupTitle}>{t(`finding_${key}_title`, params)}</span>
          <span className={styles.groupWhy}>{t(`finding_${key}_why`, params)}</span>
        </span>
        {items.length > 1 && <span className={styles.count}>{items.length}</span>}
        <IconChevronDown size={16} className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{height: 0, opacity: 0}}
            animate={{height: 'auto', opacity: 1}}
            exit={{height: 0, opacity: 0}}
            transition={{duration: 0.25, ease: EASE_OUT}}
            className={styles.groupBody}
          >
            <div className={styles.fix}>
              <span className={styles.label}>{t('findingFix')}</span>
              <span>{t(`finding_${key}_fix`, params)}</span>
            </div>
            <div className={styles.evidence}>
              {items.map((item) => (
                <pre key={item.id} className={styles.code}>
                  {item.evidence.join('\n')}
                </pre>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
};

/**
 * Findings grouped by rule, worst first, with a filter by severity.
 */
const FindingsList = ({findings, emptyText}) => {
  const {t} = useTranslation();
  const [filter, setFilter] = useState('all');

  const counts = useMemo(
    () => Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length])),
    [findings],
  );

  const groups = useMemo(() => {
    const byRule = new Map();
    for (const finding of findings) {
      if (filter !== 'all' && finding.severity !== filter) {
        continue;
      }
      byRule.set(finding.rule, [...(byRule.get(finding.rule) ?? []), finding]);
    }
    return [...byRule.entries()].sort(
      ([, a], [, b]) => severityRank(a[0].severity) - severityRank(b[0].severity) || b.length - a.length,
    );
  }, [findings, filter]);

  if (!findings.length) {
    return (
      <div className={styles.empty}>
        <IconCircleCheck size={20} />
        {emptyText ?? t('findingsNone')}
      </div>
    );
  }

  return (
    <div className={styles.list}>
      <div className={styles.filters} role="group" aria-label={t('findingsFilter')}>
        {['all', ...SEVERITIES].map((key) =>
          key === 'all' || counts[key] ? (
            <button
              key={key}
              aria-pressed={filter === key}
              className={`${styles.filter} ${filter === key ? styles.filterOn : ''}`}
              onClick={() => setFilter(key)}
            >
              {key === 'all' ? t('findingsAll') : t(`findingSeverity_${key}`)}
              <span className={styles.filterCount}>{key === 'all' ? findings.length : counts[key]}</span>
            </button>
          ) : null,
        )}
      </div>
      <motion.ul
        className={styles.groups}
        initial={{opacity: 0, y: 6}}
        animate={{opacity: 1, y: 0}}
        transition={{duration: 0.3, ease: EASE_OUT}}
      >
        {groups.map(([rule, items]) => (
          <FindingGroup key={rule} rule={rule} items={items} />
        ))}
      </motion.ul>
    </div>
  );
};

export default FindingsList;
