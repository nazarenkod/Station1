import {IconDeviceMobile, IconRefresh} from '@tabler/icons-react';
import {Alert, App, Button, Form, Input, Select} from 'antd';
import {useCallback, useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {pickSigningTeam, wdaBundleIdFor} from '../../../shared/ios/signing.js';
import {IOS_SIGNING} from '../../../shared/setting-defs.js';
import {backend, getSetting, setSetting} from '../../polyfills.js';

import styles from './SettingsPage.module.css';

/**
 * How WebDriverAgent is signed for a real iPhone: the development teams of
 * this Mac's certificates, the one to use, and its bundle id.
 */
const IosSigningSettings = () => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const [teams, setTeams] = useState(null);
  const [teamId, setTeamId] = useState(null);
  const [bundleId, setBundleId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setTeams(null);
    const saved = (await getSetting(IOS_SIGNING)) ?? {};
    setTeamId(saved.teamId ?? null);
    setBundleId(saved.bundleId ?? '');
    setTeams((await backend.device?.signingTeams?.().catch(() => [])) ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await setSetting(IOS_SIGNING, {teamId, bundleId: bundleId.trim()});
      message.success(t('settingsSaved'));
    } finally {
      setSaving(false);
    }
  };

  const used = teams ? pickSigningTeam(teams, teamId) : null;

  return (
    <section className={styles.card} aria-label={t('settingsIosTitle')}>
      <div className={styles.cardHead}>
        <span className={`${styles.logo} ${styles.logo_device}`}>
          <IconDeviceMobile size={20} stroke={1.7} />
        </span>
        <div className={styles.cardTitleBlock}>
          <span className={styles.cardTitle}>{t('settingsIosTitle')}</span>
          <span className={styles.cardPurpose}>{t('settingsIosPurpose')}</span>
        </div>
        <span className={`${styles.status} ${used ? styles.statusOn : ''}`}>
          <span className={styles.statusDot} />
          {used ? t('settingsIosReady', {team: used.teamName ?? used.teamId}) : t('settingsIosNotReady')}
        </span>
      </div>
      <div className={styles.cardBody}>
        {teams && teams.length === 0 && (
          <Alert
            className={styles.cardAlert}
            type="warning"
            showIcon
            title={t('settingsIosNoTeam')}
            description={t('settingsIosNoTeamHow')}
          />
        )}
        <Form layout="vertical">
          <Form.Item label={t('settingsIosTeam')} extra={teams?.length > 1 && !teamId ? t('settingsIosPick') : null}>
            <Select
              loading={!teams}
              value={teamId}
              onChange={setTeamId}
              allowClear
              placeholder={
                teams?.length === 1 ? t('settingsIosAuto', {team: teams[0].teamName}) : t('settingsIosTeamPlaceholder')
              }
              options={(teams ?? []).map((team) => ({
                value: team.teamId,
                label: `${team.teamName} · ${team.teamId}`,
                title: team.certificate,
              }))}
            />
          </Form.Item>
          <Form.Item label={t('settingsIosBundleId')} extra={t('settingsIosBundleIdHint')}>
            <Input
              value={bundleId}
              onChange={(e) => setBundleId(e.target.value)}
              placeholder={used ? wdaBundleIdFor(used.teamId) : 'com.example.WebDriverAgentRunner'}
              className="vi-mono"
            />
          </Form.Item>
        </Form>
        <Alert type="info" showIcon title={t('settingsIosPhoneSteps')} />
      </div>
      <div className={styles.cardFoot}>
        <Button type="primary" loading={saving} onClick={save}>
          {t('jiraSave')}
        </Button>
        <Button type="text" icon={<IconRefresh size={14} />} onClick={load}>
          {t('settingsIosRescan')}
        </Button>
      </div>
    </section>
  );
};

export default IosSigningSettings;
