import {IconPin, IconPinnedOff, IconTrash} from '@tabler/icons-react';
import {App, Button, Input, Popconfirm, Segmented, Select, Tag, Tooltip} from 'antd';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {NOTE_SCOPES, PINNED_BUDGET, STALE_DAYS, staleNotes} from '../../../shared/agent/memory.js';
import {useProfiles} from '../../lib/settings/profiles-store.js';
import {useTask} from '../../lib/task/task-store.js';
import {backend} from '../../polyfills.js';

import styles from './SettingsPage.module.css';

const NoteRow = ({note, onChanged}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const [text, setText] = useState(note.text);
  useEffect(() => setText(note.text), [note.text]);
  const update = async (patch) => {
    const result = await backend.memory.update(note.id, patch);
    if (!result.ok) {
      message.error(t(`memoryError_${result.reason}`, {defaultValue: t('memoryError_other')}));
    }
    onChanged();
  };
  return (
    <div className={styles.memoryRow}>
      <Tag>{t(`memoryKind_${note.kind}`)}</Tag>
      <Input
        value={text}
        maxLength={300}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() && text !== note.text && update({text})}
      />
      <Select
        size="small"
        value={note.scope}
        onChange={(scope) => update({scope})}
        options={NOTE_SCOPES.map((scope) => ({value: scope, label: t(`memoryScope_${scope}`)}))}
      />
      <Tooltip title={note.pinned ? t('memoryUnpin') : t('memoryPin')}>
        <Button
          size="small"
          type={note.pinned ? 'primary' : 'text'}
          icon={note.pinned ? <IconPin size={14} /> : <IconPinnedOff size={14} />}
          onClick={() => update({pinned: !note.pinned})}
          aria-label={note.pinned ? t('memoryUnpin') : t('memoryPin')}
        />
      </Tooltip>
      <span className={styles.profileHint}>
        {note.lastUsedAt
          ? t('memoryLastUsed', {date: new Date(note.lastUsedAt).toLocaleDateString(), count: note.uses})
          : t('memoryNeverUsed')}
      </span>
      <Popconfirm
        title={t('memoryDeleteAsk')}
        okText={t('memoryDelete')}
        cancelText={t('Cancel')}
        okButtonProps={{danger: true}}
        onConfirm={async () => {
          await backend.memory.remove(note.id);
          onChanged();
        }}
      >
        <Button size="small" type="text" danger icon={<IconTrash size={14} />} aria-label={t('memoryDelete')} />
      </Popconfirm>
    </div>
  );
};

/**
 * The agent's memory: the person's notes, the project's and the task's, to
 * read, fix, pin, move or delete.
 */
const MemorySettings = () => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const profiles = useProfiles();
  const task = useTask();
  const [notes, setNotes] = useState([]);
  const [pinned, setPinned] = useState(null);
  const [scope, setScope] = useState('project');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setNotes(await backend.memory.list());
    setPinned(await backend.memory.pinned());
  }, []);
  useEffect(() => {
    load();
  }, [load, profiles.activeId, task.current]);

  const shown = useMemo(
    () =>
      notes.filter((note) => note.scope === scope && (!query || note.text.toLowerCase().includes(query.toLowerCase()))),
    [notes, scope, query],
  );
  const stale = staleNotes(notes);

  return (
    <div className={styles.profileApps}>
      <div className={styles.memoryHead}>
        <Segmented
          value={scope}
          onChange={setScope}
          options={NOTE_SCOPES.map((one) => ({
            value: one,
            label: `${t(`memoryScope_${one}`)} · ${notes.filter((note) => note.scope === one).length}`,
          }))}
        />
        <Input.Search
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('memorySearch')}
          allowClear
        />
      </div>
      {pinned && (
        <span className={styles.profileHint}>
          {t('memoryPinnedBudget', {used: pinned.used, budget: PINNED_BUDGET})}
          {pinned.left > 0 ? ` · ${t('memoryPinnedLeft', {count: pinned.left})}` : ''}
        </span>
      )}
      {!shown.length && (
        <span className={styles.profileHint}>
          {t(scope === 'task' && !task.current ? 'memoryNoTask' : 'memoryEmpty')}
        </span>
      )}
      {shown.map((note) => (
        <NoteRow key={note.id} note={note} onChanged={load} />
      ))}
      {stale.length > 0 && (
        <div>
          <Popconfirm
            title={t('memoryPruneAsk', {count: stale.length, days: STALE_DAYS})}
            okText={t('memoryPrune')}
            cancelText={t('Cancel')}
            onConfirm={async () => {
              message.success(t('memoryPruned', {count: await backend.memory.prune(STALE_DAYS)}));
              load();
            }}
          >
            <Button size="small">{t('memoryPruneButton', {count: stale.length})}</Button>
          </Popconfirm>
        </div>
      )}
      <span className={styles.profileHint}>{t('memoryHint')}</span>
    </div>
  );
};

export default MemorySettings;
