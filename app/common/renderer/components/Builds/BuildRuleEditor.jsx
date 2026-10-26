import {IconDeviceDesktop, IconDeviceMobile} from '@tabler/icons-react';
import {Input, Select} from 'antd';
import {useTranslation} from 'react-i18next';

import styles from './BuildRuleEditor.module.css';

export const emptyRule = (project = '') => ({
  id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  project,
  virtual: {jobs: [], file: ''},
  real: {jobs: [], file: ''},
});

const KIND_ICON = {virtual: IconDeviceDesktop, real: IconDeviceMobile};

/**
 * One rule of where a project's builds come from: the project (its path, its
 * end, or a pattern with *), and for simulators and emulators, and for real
 * devices, the jobs to wait for in order of preference and, if the archive
 * holds several builds, which file to take.
 */
const BuildRuleEditor = ({rule, onChange, jobNames = []}) => {
  const {t} = useTranslation();
  const options = jobNames.map((name) => ({value: name, label: name}));
  const setKind = (kind, patch) => onChange({...rule, [kind]: {...rule[kind], ...patch}});

  return (
    <div className={styles.editor}>
      <label className={styles.field}>
        <span className={styles.label}>{t('buildRuleProject')}</span>
        <Input
          className="vi-mono"
          value={rule.project}
          placeholder="p24-front-end-mob/android/ap24v6"
          onChange={(e) => onChange({...rule, project: e.target.value})}
        />
        <span className={styles.hint}>{t('buildRuleProjectHint')}</span>
      </label>
      <div className={styles.kinds}>
        {['virtual', 'real'].map((kind) => {
          const Icon = KIND_ICON[kind];
          return (
            <div key={kind} className={styles.kind}>
              <div className={styles.kindTitle}>
                <Icon size={16} stroke={1.7} />
                {t(`buildRuleKind_${kind}`)}
              </div>
              <label className={styles.field}>
                <span className={styles.label}>{t('buildRuleJobs')}</span>
                <Select
                  mode="tags"
                  value={rule[kind].jobs}
                  onChange={(jobs) => setKind(kind, {jobs})}
                  options={options}
                  tokenSeparators={[',', ' ']}
                  placeholder={kind === 'real' ? t('buildRuleJobsSame') : 'build, build_bundle'}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>{t('buildRuleFile')}</span>
                <Input
                  className="vi-mono"
                  value={rule[kind].file}
                  placeholder={kind === 'virtual' ? '*.app' : '*.ipa'}
                  onChange={(e) => setKind(kind, {file: e.target.value})}
                />
              </label>
            </div>
          );
        })}
      </div>
      <span className={styles.hint}>{t('buildRuleJobsHint')}</span>
    </div>
  );
};

export default BuildRuleEditor;
