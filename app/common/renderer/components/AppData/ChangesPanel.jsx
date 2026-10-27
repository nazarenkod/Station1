import {
  IconArrowBackUp,
  IconChevronDown,
  IconChevronUp,
  IconDatabase,
  IconFile,
  IconSettings,
} from '@tabler/icons-react';
import {App, Button, Popconfirm, Tabs} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';

import {valueText} from '../../../shared/app-data/values.js';
import {revert} from './app-data-store.js';
import {formatClock, formatSize} from './format.js';

import styles from './AppData.module.css';

const SECTION_ICONS = {prefs: IconSettings, db: IconDatabase, files: IconFile};

const short = (value) => {
  if (value && typeof value === 'object' && 'rows' in value && Object.keys(value).length === 1) {
    return `${value.rows} rows`;
  }
  if (value && typeof value === 'object' && 'size' in value && Object.keys(value).length === 1) {
    return formatSize(value.size);
  }
  const text = valueText(value);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
};

const ChangeLine = ({change, onOpen}) => {
  const {t} = useTranslation();
  const Icon = SECTION_ICONS[change.section] ?? IconFile;
  const where =
    change.section === 'prefs'
      ? change.key
      : change.section === 'db'
        ? `${change.table}${change.key ? ` ${change.key}` : ''}`
        : change.file;
  return (
    <li className={`${styles.change} ${styles[`changeKind_${change.kind}`]}`}>
      <span className={styles.changeTime}>{formatClock(change.at)}</span>
      {change.screen && <span className={styles.screenChip}>{change.screen}</span>}
      <Icon size={14} className={styles.changeIcon} />
      <button type="button" className={styles.changeWhere} onClick={() => onOpen(change)} title={change.file}>
        {where}
      </button>
      <span className={styles.changeKind}>{t(`dataChange_${change.kind}`)}</span>
      {change.kind === 'changed' && change.columns?.length > 0 && (
        <span className={styles.changeValues}>
          {change.columns.slice(0, 3).map((column) => (
            <span key={column} className={styles.changeValues}>
              <span className={styles.changeKind}>{column}:</span>
              <span className={styles.before}>{short(change.before[column])}</span>
              <span className={styles.arrow}>→</span>
              <span className={styles.after}>{short(change.after[column])}</span>
            </span>
          ))}
        </span>
      )}
      {change.kind === 'changed' && !change.columns?.length && (
        <span className={styles.changeValues}>
          <span className={styles.before}>{short(change.before)}</span>
          <span className={styles.arrow}>→</span>
          <span className={styles.after}>{short(change.after)}</span>
        </span>
      )}
      {change.kind === 'added' && <span className={styles.after}>{short(change.after)}</span>}
      {change.kind === 'removed' && <span className={styles.before}>{short(change.before)}</span>}
    </li>
  );
};

const editLabel = (t, edit) =>
  t(`dataEdit_${edit.summary.kind}`, {
    key: edit.summary.key ?? '',
    file: edit.summary.file,
    sql: edit.summary.sql ?? '',
  });

/**
 * Under the data: what changed while the tab watched, and the person's own
 * edits, each of which can go back.
 */
const ChangesPanel = ({changes, edits, onOpen}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState('changes');
  const live = edits.filter((edit) => !edit.reverted);

  const back = async (id) => {
    const result = await revert(id);
    if (result?.ok) {
      message.success(t('dataReverted'));
    } else {
      message.error(result?.error ?? t('dataFailed'));
    }
  };

  return (
    <section className={`${styles.changesPanel} ${open ? '' : styles.changesClosed}`}>
      <Tabs
        size="small"
        activeKey={tab}
        onChange={(key) => {
          setTab(key);
          setOpen(true);
        }}
        tabBarExtraContent={
          <span className={styles.row}>
            {tab === 'edits' && live.length > 0 && (
              <Popconfirm
                title={t('dataRevertAllConfirm')}
                okText={t('dataRevertAll')}
                cancelText={t('dataCancel')}
                onConfirm={() => back('all')}
              >
                <Button size="small" icon={<IconArrowBackUp size={14} />}>
                  {t('dataRevertAll')}
                </Button>
              </Popconfirm>
            )}
            <Button
              size="small"
              type="text"
              icon={open ? <IconChevronDown size={14} /> : <IconChevronUp size={14} />}
              onClick={() => setOpen(!open)}
              title={open ? t('dataCollapse') : t('dataExpand')}
            />
          </span>
        }
        items={[
          {
            key: 'changes',
            label: (
              <span>
                {t('dataChanges')} {changes.length > 0 && <span className={styles.count}>{changes.length}</span>}
              </span>
            ),
            children: open ? (
              changes.length ? (
                <ul className={styles.changes}>
                  {changes.slice(0, 200).map((change) => (
                    <ChangeLine key={change.id} change={change} onOpen={onOpen} />
                  ))}
                </ul>
              ) : (
                <p className={styles.panelEmpty}>{t('dataNoChanges')}</p>
              )
            ) : null,
          },
          {
            key: 'edits',
            label: (
              <span>
                {t('dataEdits')} {live.length > 0 && <span className={styles.count}>{live.length}</span>}
              </span>
            ),
            children: open ? (
              edits.length ? (
                <ul className={styles.changes}>
                  {edits.map((edit) => (
                    <li key={edit.id} className={`${styles.change} ${edit.reverted ? styles.reverted : ''}`}>
                      <span className={styles.changeTime}>{formatClock(edit.at)}</span>
                      <span className={`${styles.changeWhere} ${styles.editWhere}`}>{editLabel(t, edit)}</span>
                      <div className={styles.spacer} />
                      {edit.reverted ? (
                        <span className={styles.muted}>{t('dataRevertedTag')}</span>
                      ) : (
                        <Button size="small" icon={<IconArrowBackUp size={14} />} onClick={() => back(edit.id)}>
                          {t('dataRevert')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.panelEmpty}>{t('dataNoEdits')}</p>
              )
            ) : null,
          },
        ]}
      />
    </section>
  );
};

export default ChangesPanel;
