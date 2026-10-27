import {IconPencil, IconPlus, IconStar, IconStarFilled, IconTrash} from '@tabler/icons-react';
import {App, Button, Popconfirm, Table, Tag, Tooltip} from 'antd';
import {useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {flutterKey} from '../../../shared/app-data/prefs-android.js';
import {removePref, setPref} from './app-data-store.js';
import PrefEditor from './PrefEditor.jsx';
import {ValueCell, ValueDrawer} from './ValueView.jsx';

import styles from './AppData.module.css';

const markClass = (mark) => (mark ? styles[`mark_${mark}`] : '');

/**
 * One preferences file as a table of key, type and value. Keys the last read
 * added or changed are coloured; removed ones stay struck through until the
 * next change.
 */
const PrefsView = ({prefs, marks, changes, pinned, onTogglePin, platform}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  const rows = useMemo(() => {
    const live = prefs.entries.map((entry) => ({...entry, mark: marks[`prefs|${prefs.file}|${entry.key}`]}));
    // what was removed in the last read, kept in sight
    const gone = changes
      .filter(
        (change) =>
          change.section === 'prefs' &&
          change.file === prefs.file &&
          change.kind === 'removed' &&
          marks[`prefs|${prefs.file}|${change.key}`] === 'removed',
      )
      .map((change) => ({key: change.key, type: '', value: change.before, mark: 'removed', ghost: true}));
    return [...live, ...gone];
  }, [prefs, marks, changes]);

  const lastChange = (key) =>
    changes.find((change) => change.section === 'prefs' && change.file === prefs.file && change.key === key);

  const save = async ({key, type, value, relaunch}) => {
    const result = await setPref(prefs.file, key, value, type, {relaunch});
    if (result?.ok) {
      message.success(t('dataSaved', {key}));
      setEditing(null);
    }
    return result;
  };

  const remove = async (key) => {
    const result = await removePref(prefs.file, key);
    if (result?.ok) {
      message.success(t('dataRemoved', {key}));
    } else {
      message.error(result?.error ?? t('dataFailed'));
    }
  };

  const columns = [
    {
      title: t('dataKey'),
      dataIndex: 'key',
      width: '34%',
      sorter: (a, b) => a.key.localeCompare(b.key),
      render: (key, row) => {
        const {prefix, name} = flutterKey(key);
        const isPinned = pinned.has(key);
        return (
          <span className={styles.keyCell}>
            {!row.ghost && (
              <button
                type="button"
                className={`${styles.pin} ${isPinned ? styles.pinOn : ''}`}
                onClick={() => onTogglePin(prefs.file, key)}
                title={isPinned ? t('dataUnpin') : t('dataPin')}
              >
                {isPinned ? <IconStarFilled size={14} /> : <IconStar size={14} />}
              </button>
            )}
            <span className={styles.mono}>
              {prefix && <span className={styles.prefix}>{prefix}</span>}
              {name}
            </span>
          </span>
        );
      },
    },
    {
      title: t('dataType'),
      dataIndex: 'type',
      width: 90,
      render: (type) => (type ? <Tag className={styles.typeTag}>{type}</Tag> : null),
    },
    {
      title: t('dataValue'),
      dataIndex: 'value',
      render: (value, row) => {
        const change = row.mark === 'changed' ? lastChange(row.key) : null;
        return (
          <div className={styles.valueWrap}>
            <ValueCell
              value={value}
              type={row.type}
              encrypted={prefs.encrypted}
              onOpen={() => setViewing({title: row.key, value, type: row.type})}
            />
            {change && (
              <Tooltip title={t('dataWas')}>
                <span className={styles.was}>{String(JSON.stringify(change.before) ?? '').slice(0, 60)}</span>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    {
      key: 'actions',
      width: 76,
      render: (_value, row) =>
        row.ghost || prefs.encrypted ? null : (
          <span className={styles.actions}>
            <Button
              size="small"
              type="text"
              icon={<IconPencil size={14} />}
              onClick={() => setEditing(row)}
              title={t('dataEdit')}
            />
            <Popconfirm
              title={t('dataRemoveConfirm', {key: row.key})}
              okText={t('dataRemove')}
              cancelText={t('dataCancel')}
              onConfirm={() => remove(row.key)}
            >
              <Button size="small" type="text" danger icon={<IconTrash size={14} />} title={t('dataRemove')} />
            </Popconfirm>
          </span>
        ),
    },
  ];

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.mono}>{prefs.file}</span>
        <Tag>{t(`dataFormat_${prefs.format}`)}</Tag>
        {prefs.encrypted && <Tag color="purple">{t('dataEncrypted')}</Tag>}
        <span className={styles.muted}>{t('dataKeys', {count: prefs.entries.length})}</span>
        <div className={styles.spacer} />
        {!prefs.encrypted && (
          <Button size="small" icon={<IconPlus size={14} />} onClick={() => setEditing('new')}>
            {t('dataEditAdd')}
          </Button>
        )}
      </div>
      {prefs.error && <p className={styles.errorLine}>{prefs.error}</p>}
      {prefs.encrypted && <p className={styles.hint}>{t('dataEncryptedHint')}</p>}
      <Table
        size="small"
        tableLayout="fixed"
        rowKey={(row) => `${row.ghost ? '-' : ''}${row.key}`}
        columns={columns}
        dataSource={rows}
        pagination={rows.length > 200 ? {pageSize: 200, showSizeChanger: false} : false}
        rowClassName={(row) => markClass(row.mark)}
        locale={{emptyText: t('dataNoKeys')}}
      />
      <PrefEditor
        open={!!editing}
        format={prefs.format}
        platform={platform}
        entry={editing === 'new' ? null : editing}
        onCancel={() => setEditing(null)}
        onSave={save}
      />
      <ValueDrawer open={!!viewing} onClose={() => setViewing(null)} {...(viewing ?? {})} />
    </div>
  );
};

export default PrefsView;
