import {IconLock, IconSparkles} from '@tabler/icons-react';
import {Alert, Button, Modal, Space} from 'antd';
import {AnimatePresence, motion} from 'motion/react';
import {useTranslation} from 'react-i18next';

import styles from './A11yTab.module.css';

/**
 * Placeholder cards that shimmer while the model looks at the screen.
 */
const AiThinking = () => {
  const {t} = useTranslation();
  return (
    <motion.div
      className={styles.aiThinking}
      initial={{opacity: 0, y: -8}}
      animate={{opacity: 1, y: 0}}
      exit={{opacity: 0, y: -8, height: 0, marginBottom: -10}}
    >
      <div className={styles.aiThinkingHead}>
        <IconSparkles size={16} className={styles.aiSparkle} />
        {t('aiRunning')}
      </div>
      {[0, 1].map((row) => (
        <div key={row} className={styles.skeletonCard}>
          <div className={styles.skeletonLine} style={{width: '45%'}} />
          <div className={styles.skeletonLine} style={{width: '85%'}} />
          <div className={styles.skeletonLine} style={{width: '60%'}} />
        </div>
      ))}
    </motion.div>
  );
};

/**
 * What the AI check is doing: thinking, failed, or waiting for consent.
 */
const AiPanel = ({a11yAi, a11yScreen, setA11yAiState, grantAiConsent, onOpenSettings}) => {
  const {t} = useTranslation();
  const forThisScreen = a11yAi?.screenKey === a11yScreen?.key;
  return (
    <>
      <AnimatePresence>
        {a11yAi?.status === 'running' && forThisScreen && <AiThinking key="thinking" />}
      </AnimatePresence>
      {a11yAi?.status === 'done' && forThisScreen && (
        <motion.div initial={{opacity: 0}} animate={{opacity: 1}} className={styles.aiDone}>
          <IconSparkles size={14} />
          {t('aiDone', {count: a11yAi.violations.length, model: a11yAi.model})}
          {a11yAi.cached && <span className={styles.aiCached}>{t('aiCached')}</span>}
        </motion.div>
      )}
      {a11yAi?.status === 'error' && forThisScreen && (
        <Alert
          type="error"
          showIcon
          closable
          title={t('aiFailed', {error: a11yAi.error})}
          onClose={() => setA11yAiState({status: 'idle'})}
        />
      )}
      <Modal
        open={a11yAi?.status === 'setup'}
        title={t('aiSetupTitle')}
        onCancel={() => setA11yAiState({status: 'idle'})}
        onOk={() => {
          setA11yAiState({status: 'idle'});
          onOpenSettings();
        }}
        okText={t('aiSettings')}
        centered
      >
        <p>{t('aiSetupText')}</p>
      </Modal>
      <Modal
        open={a11yAi?.status === 'consent'}
        title={
          <Space>
            <IconLock size={18} />
            {t('aiConsentTitle')}
          </Space>
        }
        onCancel={() => setA11yAiState({status: 'idle'})}
        footer={(_, {CancelBtn}) => (
          <Space>
            <CancelBtn />
            <Button type="primary" icon={<IconSparkles size={16} />} onClick={() => grantAiConsent()}>
              {t('aiConsentAgree')}
            </Button>
          </Space>
        )}
        centered
      >
        <p>{t('aiConsentText')}</p>
        <ul className={styles.consentList}>
          <li>{t('aiConsentSent')}</li>
          <li>{t('aiConsentMasked')}</li>
          <li>{t('aiConsentCache')}</li>
        </ul>
      </Modal>
    </>
  );
};

export default AiPanel;
