import {
  IconCode,
  IconCookie,
  IconCreditCard,
  IconFileText,
  IconKey,
  IconLock,
  IconLayoutList,
  IconNotes,
  IconShieldLock,
  IconTerminal2,
  IconTransfer,
} from '@tabler/icons-react';
import {Button} from 'antd';
import {useTranslation} from 'react-i18next';

import styles from './Agent.module.css';

// what the agent may take, and what never leaves the station
const GOES = [
  ['task', IconFileText],
  ['code', IconCode],
  ['traffic', IconTransfer],
  ['logs', IconTerminal2],
  ['screens', IconLayoutList],
  ['memory', IconNotes],
];
const NEVER = [
  ['auth', IconKey],
  ['cookies', IconCookie],
  ['personal', IconCreditCard],
  ['tokens', IconLock],
];

/**
 * Asked once for each profile, before the first message: what goes to Kiro
 * and what never does. The person can revoke it in the agent's settings.
 */
const ConsentCard = ({onAllow, onCancel, pending = false}) => {
  const {t} = useTranslation();
  return (
    <div className={styles.consent}>
      <span className={styles.consentIcon}>
        <IconShieldLock size={22} stroke={1.6} />
      </span>
      <h3 className={styles.consentTitle}>{t('agentConsentTitle')}</h3>
      <p className={styles.consentText}>{t('agentConsentText')}</p>
      <div className={styles.consentColumns}>
        <div className={styles.consentColumn}>
          <span className={styles.consentLabel}>{t('agentConsentGoes')}</span>
          {GOES.map(([part, Icon]) => (
            <span key={part} className={styles.consentItem}>
              <Icon size={15} stroke={1.7} />
              {t(`agentConsent_${part}`)}
            </span>
          ))}
        </div>
        <div className={`${styles.consentColumn} ${styles.consentNever}`}>
          <span className={styles.consentLabel}>{t('agentConsentNeverLabel')}</span>
          {NEVER.map(([part, Icon]) => (
            <span key={part} className={styles.consentItem}>
              <Icon size={15} stroke={1.7} />
              {t(`agentConsentNever_${part}`)}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.consentActions}>
        <Button type="primary" onClick={onAllow}>
          {pending ? t('agentConsentAllow') : t('agentConsentAllowOnly')}
        </Button>
        {onCancel && <Button onClick={onCancel}>{t('Cancel')}</Button>}
      </div>
      <span className={styles.consentFoot}>{t('agentConsentOnce')}</span>
    </div>
  );
};

export default ConsentCard;
