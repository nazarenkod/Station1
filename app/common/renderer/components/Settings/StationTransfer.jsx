import {IconDownload, IconHistory, IconUpload} from '@tabler/icons-react';
import {Alert, App, Button, Checkbox, Modal, Popconfirm, Segmented, Tag} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {PRODUCT_NAME} from '../../../shared/product.js';
import {PROFILE_GROUPS, STATION_GROUPS} from '../../../shared/settings/groups.js';
import {
  applyImport,
  exportSettings,
  listBackups,
  pickImport,
  restoreBackup,
} from '../../lib/settings/profiles-store.js';
import {backend} from '../../polyfills.js';

import styles from './SettingsPage.module.css';

const today = () => new Date().toISOString().slice(0, 10);

// a name a file can have
const fileSafe = (name) => name.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'profile';

const GroupChecks = ({ids, value, onChange, changes}) => {
  const {t} = useTranslation();
  return (
    <Checkbox.Group
      className={styles.groupChecks}
      value={value}
      onChange={onChange}
      options={ids.map((id) => ({
        value: id,
        label: (
          <span className={styles.groupLabel}>
            {t(`settingsGroup_${id}`)}
            {changes && (
              <Tag className={styles.groupTag} color={changes[id] ? 'processing' : 'default'}>
                {changes[id] ? t('settingsImportWillChange') : t('settingsImportSame')}
              </Tag>
            )}
          </span>
        ),
      }))}
    />
  );
};

/**
 * Saves the settings to a file: one profile to share with the team, or every
 * profile with the station's own settings to move to another Mac.
 */
export const ExportDialog = ({open, kind, profile = null, onClose}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const ids = kind === 'profile' ? PROFILE_GROUPS : [...PROFILE_GROUPS, ...STATION_GROUPS];
  const [groups, setGroups] = useState(ids);
  useEffect(() => {
    if (open) {
      setGroups(kind === 'profile' ? PROFILE_GROUPS : [...PROFILE_GROUPS, ...STATION_GROUPS]);
    }
  }, [open, kind]);

  const save = async () => {
    const fileName =
      kind === 'profile' ? `${fileSafe(profile.name)}-${today()}.json` : `station-settings-${today()}.json`;
    const saved = await exportSettings({kind, profileId: profile?.id, groups, fileName});
    if (saved) {
      message.success(t('settingsExported'));
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      title={kind === 'profile' ? t('settingsExportProfileTitle', {name: profile?.name}) : t('settingsExportAllTitle')}
      okText={t('settingsExportSave')}
      okButtonProps={{disabled: !groups.length}}
      onOk={save}
      cancelText={t('Cancel')}
      onCancel={onClose}
      destroyOnHidden
    >
      <p className={styles.sectionText}>{t('settingsExportWhat')}</p>
      <GroupChecks ids={ids} value={groups} onChange={setGroups} />
      <Alert className={styles.cardAlert} type="info" showIcon title={t('settingsNoSecrets')} />
    </Modal>
  );
};

/**
 * What an import file holds and what it would change; the person picks what to take.
 */
const ImportDialog = ({preview, onClose}) => {
  const {t} = useTranslation();
  const {message, modal} = App.useApp();
  const [choice, setChoice] = useState(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!preview) {
      return;
    }
    setChoice({
      profiles: preview.summary.profiles.map((entry) => ({
        index: entry.index,
        mode: entry.existingId ? 'replace' : 'new',
        groups: entry.groups.map((group) => group.id),
      })),
      // the station's own settings change only when asked
      station: [],
    });
  }, [preview]);

  if (!preview || !choice) {
    return null;
  }

  const setProfile = (index, patch) =>
    setChoice({
      ...choice,
      profiles: choice.profiles.map((entry) => (entry.index === index ? {...entry, ...patch} : entry)),
    });

  const nothing =
    choice.profiles.every((entry) => entry.mode === 'skip' || !entry.groups.length) && !choice.station.length;

  const apply = async () => {
    setApplying(true);
    try {
      const result = await applyImport(choice);
      if (!result?.ok) {
        message.error(t(`settingsImportError_${result?.error ?? 'format'}`, {detail: result?.detail ?? ''}));
        return;
      }
      onClose();
      message.success(t('settingsImported'));
      // keys stay on the Mac they were typed on: say which ones this Mac still needs
      if (choice.station.includes('integrations')) {
        const missing = [
          !(await backend.jira?.hasToken()) && 'Jira',
          !(await backend.gitlab?.hasToken()) && 'GitLab',
          !(await backend.ai?.hasKey()) && 'AI',
        ].filter(Boolean);
        if (missing.length) {
          modal.info({
            title: t('settingsImportTokensTitle'),
            content: t('settingsImportTokens', {list: missing.join(', ')}),
          });
        }
      }
    } finally {
      setApplying(false);
    }
  };

  const stationChanges = Object.fromEntries(preview.summary.station.map((group) => [group.id, group.changed]));

  return (
    <Modal
      open
      width={620}
      title={t('settingsImportTitle', {file: preview.fileName})}
      okText={t('settingsImportApply')}
      okButtonProps={{disabled: nothing, loading: applying}}
      onOk={apply}
      cancelText={t('Cancel')}
      onCancel={onClose}
    >
      <p className={styles.sectionText}>
        {t('settingsImportFrom', {
          product: preview.file.product || PRODUCT_NAME,
          date: preview.file.exportedAt ? new Date(preview.file.exportedAt).toLocaleString() : '—',
        })}
      </p>
      {preview.summary.profiles.map((entry) => {
        const picked = choice.profiles.find((candidate) => candidate.index === entry.index);
        const changes = Object.fromEntries(entry.groups.map((group) => [group.id, group.changed]));
        return (
          <section key={entry.index} className={styles.importBlock}>
            <div className={styles.importHead}>
              <span className={styles.cardTitle}>{entry.name}</span>
              <Segmented
                size="small"
                value={picked.mode}
                onChange={(mode) => setProfile(entry.index, {mode})}
                options={[
                  ...(entry.existingId ? [{value: 'replace', label: t('settingsImportReplace')}] : []),
                  {value: 'new', label: t('settingsImportNew')},
                  {value: 'skip', label: t('settingsImportSkip')},
                ]}
              />
            </div>
            {picked.mode !== 'skip' && (
              <GroupChecks
                ids={entry.groups.map((group) => group.id)}
                value={picked.groups}
                onChange={(groups) => setProfile(entry.index, {groups})}
                changes={picked.mode === 'replace' ? changes : null}
              />
            )}
          </section>
        );
      })}
      {preview.summary.station.length > 0 && (
        <section className={styles.importBlock}>
          <div className={styles.importHead}>
            <span className={styles.cardTitle}>{t('settingsImportStation')}</span>
          </div>
          <GroupChecks
            ids={preview.summary.station.map((group) => group.id)}
            value={choice.station}
            onChange={(station) => setChoice({...choice, station})}
            changes={stationChanges}
          />
        </section>
      )}
      <Alert className={styles.cardAlert} type="info" showIcon title={t('settingsImportBackupNote')} />
    </Modal>
  );
};

/**
 * Export, import and the backup copies the station keeps by itself.
 */
const StationTransfer = () => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const [exporting, setExporting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [backups, setBackups] = useState([]);

  const loadBackups = async () => setBackups((await listBackups()) ?? []);
  useEffect(() => {
    loadBackups();
  }, []);

  if (!backend.settings) {
    return null;
  }

  const startImport = async () => {
    const result = await pickImport();
    if (!result) {
      return;
    }
    if (!result.ok) {
      Modal.error({
        title: t('settingsImportFailed'),
        content: t(`settingsImportError_${result.error}`, {detail: result.detail ?? ''}),
      });
      return;
    }
    setPreview(result);
  };

  const restore = async (file) => {
    const result = await restoreBackup(file);
    if (result?.ok) {
      message.success(t('settingsRestored'));
    } else {
      message.error(t(`settingsImportError_${result?.error ?? 'format'}`, {detail: result?.detail ?? ''}));
    }
    await loadBackups();
  };

  return (
    <section className={`${styles.card} ${styles.cardOpen}`} aria-label={t('settingsTransferTitle')}>
      <div className={styles.cardHead}>
        <span className={`${styles.logo} ${styles.logo_device}`}>
          <IconHistory size={18} stroke={1.7} />
        </span>
        <div className={styles.cardTitleBlock}>
          <span className={styles.cardTitle}>{t('settingsTransferTitle')}</span>
          <span className={styles.cardPurpose}>{t('settingsTransferPurpose')}</span>
        </div>
      </div>
      <div className={styles.cardBody}>
        <div className={styles.profileActions}>
          <Button icon={<IconDownload size={16} />} onClick={() => setExporting(true)}>
            {t('settingsExportAll')}
          </Button>
          <Button icon={<IconUpload size={16} />} onClick={startImport}>
            {t('settingsImport')}
          </Button>
        </div>
        <div className={styles.backups}>
          <span className={styles.backupsTitle}>{t('settingsBackups')}</span>
          {!backups.length && <span className={styles.profileHint}>{t('settingsBackupsNone')}</span>}
          {backups.map((backup) => (
            <div key={backup.file} className={styles.backupRow}>
              <span>{new Date(backup.createdAt).toLocaleString()}</span>
              <span className={styles.profileHint}>
                {t(`settingsBackupReason_${backup.reason}`, {defaultValue: backup.reason})}
              </span>
              <Popconfirm
                title={t('settingsRestoreAsk')}
                description={t('settingsRestoreHint')}
                okText={t('settingsRestore')}
                cancelText={t('Cancel')}
                onConfirm={() => restore(backup.file)}
              >
                <Button size="small" type="link">
                  {t('settingsRestore')}
                </Button>
              </Popconfirm>
            </div>
          ))}
        </div>
      </div>
      <ExportDialog open={exporting} kind="all" onClose={() => setExporting(false)} />
      <ImportDialog
        preview={preview}
        onClose={() => {
          setPreview(null);
          loadBackups();
        }}
      />
    </section>
  );
};

export default StationTransfer;
