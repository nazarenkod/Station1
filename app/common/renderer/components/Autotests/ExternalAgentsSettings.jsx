import {IconCopy, IconPlugConnected} from '@tabler/icons-react';
import {App, Button, Switch} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {backend} from '../../polyfills.js';

import settingsStyles from '../Settings/SettingsPage.module.css';
import styles from './Autotests.module.css';

// what the test agent puts in its mcp.json: the bridge with the station's data folder
const snippet = ({node, cli, dataDir}) =>
  JSON.stringify(
    {
      mcpServers: {
        station: {
          command: node ?? 'vision-inspector',
          args: node ? [cli, 'mcp'] : ['mcp'],
          env: {STATION_DATA_DIR: dataDir, ...(node ? {ELECTRON_RUN_AS_NODE: '1'} : {})},
        },
      },
    },
    null,
    2,
  );

/**
 * Access for an agent outside the station (the test agent in Kiro): off by
 * default; on, it reads the packages of screen objects through the bridge
 * and nothing else.
 */
const ExternalAgentsSettings = () => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const [state, setState] = useState(null);
  useEffect(() => {
    backend.autotests?.external().then(setState);
    return backend.autotests?.onChanged(() => backend.autotests.external().then(setState));
  }, []);
  if (!state) {
    return null;
  }
  const text = snippet(state);
  return (
    <section className={`${settingsStyles.card} ${settingsStyles.cardOpen}`} aria-label={t('externalTitle')}>
      <div className={settingsStyles.cardHead}>
        <span className={`${settingsStyles.logo} ${settingsStyles.logo_ai}`}>
          <IconPlugConnected size={18} stroke={1.7} />
        </span>
        <span className={settingsStyles.cardTitleBlock}>
          <span className={settingsStyles.cardTitle}>{t('externalTitle')}</span>
          <span className={settingsStyles.cardPurpose}>{t('externalPurpose')}</span>
        </span>
        <Switch
          checked={state.enabled}
          aria-label={t('externalTitle')}
          onChange={async (enabled) => setState({...state, ...(await backend.autotests.setExternal(enabled))})}
        />
      </div>
      {state.enabled && (
        <div className={settingsStyles.cardBody}>
          <div className={settingsStyles.profileApps}>
            <div className={settingsStyles.mcpRow}>
              <span className={settingsStyles.agentLabel}>{t('externalSnippet')}</span>
              <span className={settingsStyles.spacer} />
              <Button
                size="small"
                icon={<IconCopy size={14} />}
                onClick={async () => {
                  await navigator.clipboard.writeText(text);
                  message.success(t('autotestsCopied'));
                }}
              >
                {t('autotestsCopy')}
              </Button>
            </div>
            <pre className={styles.code}>{text}</pre>
            <span className={settingsStyles.profileHint}>{t('externalHint')}</span>
            <span className={settingsStyles.profileHint}>
              {state.lastAccess
                ? t('externalLast', {date: new Date(state.lastAccess).toLocaleString(), tool: state.lastTool ?? ''})
                : t('externalNever')}
            </span>
          </div>
        </div>
      )}
    </section>
  );
};

export default ExternalAgentsSettings;
