import {IconChevronDown, IconPackage, IconPlus, IconTrash} from '@tabler/icons-react';
import {App, Button, Empty} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import BuildRuleEditor, {emptyRule} from '../Builds/BuildRuleEditor.jsx';
import {loadBuildSources, saveBuildSources, usePipelineWatches} from '../Builds/pipeline-watch.js';

import styles from './SettingsPage.module.css';

const summary = (rule, t) =>
  ['virtual', 'real']
    .map((kind) =>
      rule[kind].jobs.length ? `${t(`buildRuleKindShort_${kind}`)}: ${rule[kind].jobs.join(', ')}` : null,
    )
    .filter(Boolean)
    .join(' · ') || t('buildRuleNoJobs');

/**
 * Where each project's builds come from, written once: a pipeline link of
 * the project is then followed without asking.
 */
const BuildSourcesSettings = ({openProject = null}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const {sources} = usePipelineWatches();
  const [rules, setRules] = useState(null);
  const [open, setOpen] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadBuildSources();
  }, []);

  // the saved rules are edited as a draft until saved
  useEffect(() => {
    if (rules === null) {
      setRules(sources.rules);
      const asked = openProject && sources.rules.find((rule) => rule.project === openProject);
      setOpen(asked?.id ?? null);
    }
  }, [sources.rules, rules, openProject]);

  const list = rules ?? [];
  const change = (id, next) => setRules(list.map((rule) => (rule.id === id ? next : rule)));
  const add = () => {
    const rule = emptyRule(openProject ?? '');
    setRules([...list, rule]);
    setOpen(rule.id);
  };
  const save = async () => {
    setSaving(true);
    try {
      await saveBuildSources(list.filter((rule) => rule.project.trim()));
      message.success(t('settingsSaved'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={`${styles.card} ${styles.cardOpen}`} aria-label={t('buildSourcesTitle')}>
      <div className={styles.cardHead}>
        <span className={`${styles.logo} ${styles.logo_gitlab}`}>
          <IconPackage size={18} stroke={1.7} />
        </span>
        <span className={styles.cardTitleBlock}>
          <span className={styles.cardTitle}>{t('buildSourcesTitle')}</span>
          <span className={styles.cardPurpose}>{t('buildSourcesPurpose')}</span>
        </span>
      </div>
      <div className={styles.cardBody}>
        {list.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('buildSourcesEmpty')} />
        ) : (
          <ul className={styles.rules}>
            {list.map((rule) => (
              <li key={rule.id} className={styles.rule}>
                <button
                  type="button"
                  className={styles.ruleHead}
                  aria-expanded={open === rule.id}
                  onClick={() => setOpen(open === rule.id ? null : rule.id)}
                >
                  <span className={styles.ruleText}>
                    <span className="vi-mono">{rule.project || t('buildRuleNewProject')}</span>
                    <span className={styles.cardPurpose}>{summary(rule, t)}</span>
                  </span>
                  <IconChevronDown
                    size={16}
                    className={styles.chevron}
                    style={{transform: open === rule.id ? 'rotate(180deg)' : 'none'}}
                    aria-hidden="true"
                  />
                </button>
                {open === rule.id && (
                  <div className={styles.ruleBody}>
                    <BuildRuleEditor rule={rule} onChange={(next) => change(rule.id, next)} />
                    <Button
                      danger
                      type="text"
                      size="small"
                      icon={<IconTrash size={14} />}
                      onClick={() => setRules(list.filter((item) => item.id !== rule.id))}
                    >
                      {t('buildRuleDelete')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={styles.cardFoot}>
        <Button type="primary" loading={saving} onClick={save}>
          {t('jiraSave')}
        </Button>
        <Button icon={<IconPlus size={14} />} onClick={add}>
          {t('buildRuleAdd')}
        </Button>
      </div>
    </section>
  );
};

export default BuildSourcesSettings;
