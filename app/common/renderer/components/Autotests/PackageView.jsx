import {IconCopy, IconRefresh, IconSparkles} from '@tabler/icons-react';
import {App, Button, Input, Modal, Spin, Switch, Tag, Tooltip} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {useProfiles} from '../../lib/settings/profiles-store.js';
import {backend} from '../../polyfills.js';

import styles from './Autotests.module.css';

/**
 * Asks the agent for the code of screen objects, and asks the person what
 * only they can answer on the way: the consent of the project, a yes past
 * the credit threshold.
 * @returns {Promise<boolean>} whether code was written
 */
export function useGenerate() {
  const {t} = useTranslation();
  const {message, modal} = App.useApp();
  const profiles = useProfiles();
  const confirm = (options) =>
    new Promise((resolve) => modal.confirm({...options, onOk: () => resolve(true), onCancel: () => resolve(false)}));

  const generate = async (packageId, options = {}) => {
    const result = await backend.autotests.generate(packageId, options);
    if (result.ok) {
      message[result.written < result.asked ? 'warning' : 'success'](
        t('autotestsGenerated', {written: result.written, asked: result.asked}),
      );
      return true;
    }
    if (result.error === 'consent') {
      const yes = await confirm({
        title: t('agentConsentTitle'),
        content: t('autotestsConsentText'),
        okText: t('agentConsentAllowOnly'),
        cancelText: t('Cancel'),
      });
      if (yes) {
        await backend.agent.consent(profiles.activeId, true);
        return await generate(packageId, options);
      }
      return false;
    }
    if (result.error === 'creditLimit') {
      const yes = await confirm({
        title: t('autotestsCreditsTitle'),
        content: t('autotestsCreditsText', {spent: result.detail}),
        okText: t('autotestsGenerate'),
        cancelText: t('Cancel'),
      });
      return yes ? await generate(packageId, {...options, confirmCredits: true}) : false;
    }
    if (result.error === 'missing') {
      message.error(
        t('autotestsMissing', {what: result.missing.map((one) => t(`autotestsMissing_${one}`)).join(', ')}),
      );
      return false;
    }
    if (result.error === 'noCode') {
      modal.error({
        title: t('autotestsNoCode'),
        content: <pre className={styles.code}>{result.detail}</pre>,
        width: 720,
      });
      return false;
    }
    message.error(t(`agentError_${result.error}`, {defaultValue: t('agentError_other')}));
    return false;
  };
  return generate;
}

const Shot = ({packageId, file}) => {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (file) {
      backend.autotests.shot(packageId, file).then(setData);
    }
  }, [packageId, file]);
  return data ? <img className={styles.shot} src={`data:image/jpeg;base64,${data}`} alt="" /> : null;
};

/**
 * One package: its screen objects, the states and elements of each, the
 * code the agent wrote; generating it, again with a word of what to change,
 * and the mark that the package is ready for the test agent.
 */
const PackageView = ({packageId, onClose}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const generate = useGenerate();
  const [pack, setPack] = useState(null);
  const [shownId, setShownId] = useState(null);
  const [working, setWorking] = useState(null);
  const [hint, setHint] = useState('');

  const load = async () => setPack(await backend.autotests.get(packageId));
  useEffect(() => {
    if (packageId) {
      setPack(null);
      setShownId(null);
      load();
    }
    // a package is read again when another one opens
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId]);

  const shown = pack?.objects.find((object) => object.id === shownId) ?? pack?.objects[0] ?? null;

  const run = async (objectIds, words = '') => {
    setWorking(objectIds ? objectIds[0] : 'all');
    try {
      if (await generate(packageId, {objectIds, hint: words})) {
        setHint('');
        await load();
      }
    } finally {
      setWorking(null);
    }
  };

  return (
    <Modal open={!!packageId} onCancel={onClose} footer={null} width={1040} title={pack?.name ?? ''} destroyOnHidden>
      {!pack ? (
        <Spin />
      ) : (
        <div className={styles.summary}>
          <div className={styles.objectHead}>
            <Button
              type="primary"
              icon={<IconSparkles size={14} />}
              loading={working === 'all'}
              disabled={!!working}
              onClick={() => run(null)}
            >
              {pack.objects.some((object) => object.code) ? t('autotestsGenerateAgain') : t('autotestsGenerate')}
            </Button>
            <label className={styles.objectHead}>
              <Switch
                size="small"
                checked={pack.ready}
                onChange={async (ready) => setPack(await backend.autotests.update(packageId, {ready}))}
              />
              {t('autotestsReady')}
            </label>
            {pack.takenAt && (
              <Tag color="green">{t('autotestsTaken', {date: new Date(pack.takenAt).toLocaleString()})}</Tag>
            )}
          </div>
          <div className={styles.packageView}>
            <nav className={styles.objects} aria-label={t('autotestsObjects')}>
              {pack.objects.map((object) => (
                <button
                  key={object.id}
                  type="button"
                  className={`${styles.object} ${object.id === shown?.id ? styles.objectShown : ''}`}
                  onClick={() => setShownId(object.id)}
                >
                  <span className={styles.mono}>{object.name}</span>
                  <span className={styles.packageMeta}>
                    {t('autotestsObjectMeta', {count: object.elements.length})}
                    {object.code ? ` · ${t('autotestsHasCode')}` : ''}
                  </span>
                </button>
              ))}
            </nav>
            {shown && (
              <div className={styles.objectMain}>
                <div className={styles.objectHead}>
                  <Input
                    className={`${styles.mono} ${styles.nameField}`}
                    defaultValue={shown.name}
                    key={shown.id}
                    aria-label={t('autotestsObjectName')}
                    onBlur={async (e) => {
                      if (e.target.value.trim() && e.target.value.trim() !== shown.name) {
                        setPack(await backend.autotests.update(packageId, {objectNames: {[shown.id]: e.target.value}}));
                      }
                    }}
                  />
                  <span className={styles.packageMeta}>
                    {shown.screen} · {shown.states.map((state) => state.title).join(' + ')}
                  </span>
                </div>
                <div className={styles.shots}>
                  {shown.states.map((state) => (
                    <Shot key={state.title} packageId={packageId} file={state.shot} />
                  ))}
                </div>
                {shown.code ? (
                  <>
                    <div className={styles.objectHead}>
                      <span className={styles.packageMeta}>
                        {t('autotestsWrittenAt', {date: new Date(shown.generatedAt).toLocaleString()})}
                      </span>
                      <Tooltip title={t('autotestsCopy')}>
                        <Button
                          size="small"
                          type="text"
                          icon={<IconCopy size={14} />}
                          aria-label={t('autotestsCopy')}
                          onClick={async () => {
                            await navigator.clipboard.writeText(shown.code);
                            message.success(t('autotestsCopied'));
                          }}
                        />
                      </Tooltip>
                    </div>
                    <pre className={styles.code}>{shown.code}</pre>
                  </>
                ) : (
                  <p className={styles.hint}>{t('autotestsNoCodeYet')}</p>
                )}
                <Input.Search
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                  placeholder={t('autotestsHint')}
                  enterButton={
                    <span>
                      <IconRefresh size={14} /> {shown.code ? t('autotestsRegenerate') : t('autotestsGenerateOne')}
                    </span>
                  }
                  loading={working === shown.id}
                  disabled={!!working && working !== shown.id}
                  onSearch={(words) => run([shown.id], words)}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
};

export default PackageView;
