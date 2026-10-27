import {IconChevronDown, IconPlus, IconTrash} from '@tabler/icons-react';
import {App, Button} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {rulePlatform} from '../../../shared/settings/platforms.js';
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
 * Where the builds of one platform of the project come from in GitLab: a
 * line per rule (the project and its jobs), opened into the editor. The
 * rules of the other platforms are kept as they are when these are saved.
 * `openProject` opens a new rule for a GitLab project a pipeline asked about.
 */
const BuildSourcesSettings = ({platform, platforms, openProject = null}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const {sources} = usePipelineWatches();
  const [draft, setDraft] = useState(null);
  const [open, setOpen] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadBuildSources();
  }, []);

  const mine = (rule) => rulePlatform(rule, platforms) === platform;
  const saved = sources.rules.filter(mine);
  const list = draft ?? saved;

  // a pipeline without a rule opens one for its project, once
  useEffect(() => {
    if (openProject && draft === null && !saved.some((rule) => rule.project === openProject)) {
      const rule = {...emptyRule(openProject), platform};
      setDraft([...saved, rule]);
      setOpen(rule.id);
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [openProject]);

  const edit = (next) => setDraft(next);
  const add = () => {
    const rule = {...emptyRule(''), platform};
    edit([...list, rule]);
    setOpen(rule.id);
  };
  const save = async () => {
    setSaving(true);
    try {
      const others = sources.rules.filter((rule) => !mine(rule));
      // each rule of this block says its platform from now on
      const own = list.filter((rule) => rule.project.trim()).map((rule) => ({...rule, platform}));
      await saveBuildSources([...others, ...own]);
      setDraft(null);
      message.success(t('settingsSaved'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.platformBuilds}>
      {list.length > 0 && (
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
                  <BuildRuleEditor
                    rule={rule}
                    onChange={(next) => edit(list.map((item) => (item.id === rule.id ? next : item)))}
                  />
                  <Button
                    danger
                    type="text"
                    size="small"
                    icon={<IconTrash size={14} />}
                    onClick={() => edit(list.filter((item) => item.id !== rule.id))}
                  >
                    {t('buildRuleDelete')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!list.length && <span className={styles.profileHint}>{t('settingsBuildsEmpty')}</span>}
      <div className={styles.platformBuildsActions}>
        <Button size="small" icon={<IconPlus size={14} />} onClick={add}>
          {t('buildRuleAdd')}
        </Button>
        {draft !== null && (
          <>
            <Button size="small" type="primary" loading={saving} onClick={save}>
              {t('jiraSave')}
            </Button>
            <Button size="small" type="text" onClick={() => setDraft(null)}>
              {t('Cancel')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default BuildSourcesSettings;
