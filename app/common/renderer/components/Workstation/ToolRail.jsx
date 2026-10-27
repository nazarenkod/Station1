import {IconSettings} from '@tabler/icons-react';
import {Tooltip} from 'antd';
import {useTranslation} from 'react-i18next';
import {useSelector} from 'react-redux';
import {Link, useLocation} from 'react-router';

import {doctorProblems, doctorSeverity, useDoctor} from '../Desk/doctor-store.js';
import {toolOf, TOOLS} from './tools.js';

import styles from './Workstation.module.css';

/**
 * The tools down the left edge of the window, each with its colour, icon and
 * name, and what needs attention in it on the icon. The settings sit at the
 * bottom. The Inspector returns to the running session when there is one.
 */
const ToolRail = () => {
  const {t} = useTranslation();
  const {pathname} = useLocation();
  const hasSession = useSelector((state) => !!state.inspector.driver);
  // errors and warnings only: the hints would make every screen look broken
  const violations = useSelector((state) => state.inspector.a11yScan?.violations);
  const a11y = (violations ?? []).filter((v) => v.severity !== 'info');
  const appium = useSelector((state) => state.workstation.appium);
  const {report} = useDoctor();
  const current = toolOf(pathname)?.key;

  const badges = {
    inspector: a11y.length
      ? {count: a11y.length, severity: a11y.some((v) => v.severity === 'error') ? 'error' : 'warn'}
      : null,
    station:
      report && doctorProblems(report, appium)
        ? {count: doctorProblems(report, appium), severity: doctorSeverity(report, appium)}
        : null,
  };

  return (
    <nav className={styles.rail} aria-label={t('wsToolsLabel')}>
      {TOOLS.map((tool) => {
        const active = tool.key === current;
        const target = tool.key === 'inspector' && hasSession ? '/inspector' : tool.path;
        const Icon = tool.icon;
        const badge = badges[tool.key];
        return (
          <Link
            key={tool.key}
            to={target}
            className={`${styles.railItem} ${styles[`tool_${tool.key}`]} ${active ? styles.railActive : ''}`}
            aria-current={active ? 'page' : undefined}
            title={t(`wsTool_${tool.key}`)}
          >
            <span className={styles.railIcon}>
              <Icon size={20} stroke={1.7} />
              {badge && (
                <span className={`${styles.railBadge} ${styles[`railBadge_${badge.severity}`]}`}>{badge.count}</span>
              )}
            </span>
            <span className={styles.railLabel}>{t(`wsTool_${tool.key}`)}</span>
            {!tool.ready && <span className={styles.railSoon}>{t('wsSoon')}</span>}
          </Link>
        );
      })}
      <span className={styles.railSpacer} />
      <Tooltip title={t('wsSettings')} placement="right">
        <Link
          to="/settings"
          className={`${styles.railItem} ${pathname === '/settings' ? styles.railActive : ''}`}
          aria-current={pathname === '/settings' ? 'page' : undefined}
        >
          <span className={styles.railIcon}>
            <IconSettings size={20} stroke={1.7} />
          </span>
          <span className={styles.railLabel}>{t('wsSettingsShort')}</span>
        </Link>
      </Tooltip>
    </nav>
  );
};

export default ToolRail;
