import {IconApps, IconChevronDown, IconRefresh, IconX} from '@tabler/icons-react';
import {Button, Input, Popover} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useDispatch, useSelector} from 'react-redux';

import {refreshApps, selectApp} from '../../actions/Workstation.js';
import {backend} from '../../polyfills.js';

import styles from './Workstation.module.css';

const MAX_LISTED = 60;

/**
 * Why the device's apps could not be read, in words a tester can act on.
 */
export const appsProblemText = (error, t) =>
  t(`wsAppsError_${error.reason}`, {
    xcode: error.xcode || '?',
    ios: error.ios || '?',
    message: error.message ?? '',
    defaultValue: error.message ?? t('wsAppsError_failed'),
  });

export const appVersionLabel = (app) => [app?.version, app?.build && `(${app.build})`].filter(Boolean).join(' ');

/**
 * The app every tool works with: picked from the apps on the device, from the
 * recent ones, or typed as a package name or bundle id.
 */
const AppPicker = () => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const {app, apps, appsLoading, appsError, recentApps} = useSelector((state) => state.workstation);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  if (!backend.device) {
    return null;
  }

  const pick = async (id) => {
    setOpen(false);
    setQuery('');
    await dispatch(selectApp(id));
  };

  const needle = query.trim().toLowerCase();
  const matches = (candidate) =>
    !needle || candidate.id.toLowerCase().includes(needle) || candidate.name?.toLowerCase().includes(needle);
  const recent = recentApps.filter(matches);
  const recentIds = new Set(recent.map((candidate) => candidate.id));
  const installed = apps.filter((candidate) => matches(candidate) && !recentIds.has(candidate.id)).slice(0, MAX_LISTED);

  const item = (candidate) => (
    <button
      key={candidate.id}
      className={`${styles.menuItem} ${candidate.id === app?.id ? styles.menuItemActive : ''}`}
      onClick={() => pick(candidate.id)}
    >
      <span className={styles.menuItemText}>
        <span>{candidate.name && candidate.name !== candidate.id ? candidate.name : candidate.id}</span>
        <span className={`${styles.menuItemSub} ${styles.mono}`}>
          {candidate.id}
          {appVersionLabel(candidate) ? ` · ${appVersionLabel(candidate)}` : ''}
        </span>
      </span>
    </button>
  );

  const content = (
    <div className={styles.menu}>
      <Input
        autoFocus
        allowClear
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onPressEnter={() => query.trim() && pick(query)}
        placeholder={t('wsAppSearch')}
        className={styles.mono}
      />
      {recent.length > 0 && <div className={styles.menuLabel}>{t('wsAppsRecent')}</div>}
      {recent.map(item)}
      {installed.length > 0 && <div className={styles.menuLabel}>{t('wsAppsOnDevice')}</div>}
      {installed.map(item)}
      {!appsLoading && appsError && <div className={styles.menuError}>{appsProblemText(appsError, t)}</div>}
      {!appsLoading && !appsError && !recent.length && !installed.length && (
        <div className={styles.menuLabel}>{needle ? t('wsAppTypeEnter') : t('wsAppsNone')}</div>
      )}
      <div className={styles.menuFooter}>
        <Button
          size="small"
          icon={<IconRefresh size={14} />}
          loading={appsLoading}
          onClick={() => dispatch(refreshApps())}
        >
          {t('wsRefresh')}
        </Button>
        {app && (
          <Button size="small" type="text" icon={<IconX size={14} />} onClick={() => pick('')}>
            {t('wsAppClear')}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Popover content={content} trigger="click" placement="bottomLeft" open={open} onOpenChange={setOpen} arrow={false}>
      <button className={styles.picker} aria-label={t('wsPickApp')} title={app?.id ?? t('wsPickApp')}>
        <IconApps size={16} stroke={1.6} />
        {app ? (
          <>
            <span className={`${styles.pickerMain} ${styles.mono}`}>{app.id}</span>
            {app.installed === false ? (
              <span className={styles.pickerSub}>{t('wsAppNotInstalled')}</span>
            ) : (
              appVersionLabel(app) && <span className={styles.pickerSub}>{appVersionLabel(app)}</span>
            )}
          </>
        ) : (
          <span className={styles.pickerEmpty}>{t('wsPickApp')}</span>
        )}
        <IconChevronDown size={14} opacity={0.6} />
      </button>
    </Popover>
  );
};

export default AppPicker;
