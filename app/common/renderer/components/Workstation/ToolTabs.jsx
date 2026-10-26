import {motion} from 'motion/react';
import {useTranslation} from 'react-i18next';
import {useSelector} from 'react-redux';
import {Link, useLocation} from 'react-router';

import {toolOf, TOOLS} from './tools.js';

import styles from './Workstation.module.css';

/**
 * One pill per tool, each marked with its tool colour. The Inspector tab returns to the running session when
 * there is one, and to the session builder otherwise.
 */
const ToolTabs = () => {
  const {t} = useTranslation();
  const {pathname} = useLocation();
  const hasSession = useSelector((state) => !!state.inspector.driver);
  const a11yOpen = useSelector((state) => state.inspector.a11yScan?.violations?.length ?? 0);
  const current = toolOf(pathname)?.key;

  const badges = {a11y: a11yOpen || null};

  return (
    <nav className={styles.tabs} aria-label={t('wsToolsLabel')}>
      {TOOLS.map((tool) => {
        const active = tool.key === current;
        const target = tool.key === 'inspector' && hasSession ? '/inspector' : tool.path;
        return (
          <Link
            key={tool.key}
            to={target}
            className={`${styles.tab} ${styles[`tool_${tool.key}`]} ${active ? styles.tabActive : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            {active && (
              <motion.span
                layoutId="ws-tab-pill"
                className={styles.tabPill}
                transition={{type: 'spring', stiffness: 500, damping: 40}}
              />
            )}
            <span className={styles.tabDot} aria-hidden="true" />
            <span className={styles.tabLabel}>{t(`wsTool_${tool.key}`)}</span>
            {badges[tool.key] ? <span className={styles.tabBadge}>{badges[tool.key]}</span> : null}
            {!tool.ready && <span className={styles.tabSoon}>{t('wsSoon')}</span>}
          </Link>
        );
      })}
    </nav>
  );
};

export default ToolTabs;
