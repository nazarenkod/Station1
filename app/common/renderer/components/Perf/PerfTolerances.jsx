import {Button, Drawer, InputNumber} from 'antd';
import {useTranslation} from 'react-i18next';

import {PERF_DEFAULTS, perfSettings} from '../../../shared/perf/baseline.js';
import {perfConfig, usePerfConfig} from '../../lib/settings/views.js';
import {MB} from './perf-format.js';

import styles from './Perf.module.css';

// each field: where it lives in the settings, and how a person reads it (percent, megabytes, a count)
const FIELDS = [
  {section: 'tolerances', key: 'memory', unit: 'share'},
  {section: 'tolerances', key: 'cpu', unit: 'share'},
  {section: 'tolerances', key: 'start', unit: 'share', later: true},
  {section: null, key: 'baselineRuns', unit: 'count', min: 1, max: 20},
  {section: 'rules', key: 'cpuPercent', unit: 'count', min: 1, max: 100, suffix: '%'},
  {section: 'rules', key: 'cpuSeconds', unit: 'count', min: 1, max: 600},
  {section: 'rules', key: 'memoryGrowthBytes', unit: 'megabytes', min: 1},
  {section: 'rules', key: 'memoryGrowthShare', unit: 'share'},
];

const shown = (unit, value) =>
  unit === 'share' ? Math.round(value * 100) : unit === 'megabytes' ? Math.round(value / MB) : value;
const stored = (unit, value) => (unit === 'share' ? value / 100 : unit === 'megabytes' ? value * MB : value);

/**
 * The project's tolerances against the reference, the runs a reference takes
 * and the thresholds of the findings without one. They go with the profile,
 * so another project has its own, and work at once.
 */
const PerfTolerances = ({open, onClose, project}) => {
  const {t} = useTranslation();
  const saved = usePerfConfig();
  const settings = perfSettings(saved);
  const valueOf = (field) => (field.section ? settings[field.section][field.key] : settings[field.key]);

  const change = (field, value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return;
    }
    const next = stored(field.unit, value);
    perfConfig.update((view) =>
      field.section ? {[field.section]: {...view[field.section], [field.key]: next}} : {[field.key]: next},
    );
  };

  const field = (item) => (
    <label key={item.key} className={styles.toleranceRow}>
      <span className={styles.toleranceText}>
        <span className={styles.toleranceLabel}>{t(`perfTol_${item.key}`)}</span>
        <span className={styles.toleranceHint}>
          {t(`perfTolHint_${item.key}`)}
          {item.later && ` ${t('perfTolLater')}`}
        </span>
      </span>
      <InputNumber
        size="small"
        min={item.min ?? 0}
        max={item.max}
        value={shown(item.unit, valueOf(item))}
        suffix={item.suffix ?? (item.unit === 'share' ? '%' : item.unit === 'megabytes' ? 'MB' : undefined)}
        onChange={(value) => change(item, value)}
        className={styles.toleranceInput}
      />
    </label>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={460}
      title={project ? t('perfTolTitleProject', {project}) : t('perfTolTitle')}
      footer={
        <Button onClick={() => perfConfig.update(() => structuredClone(PERF_DEFAULTS))}>{t('perfTolReset')}</Button>
      }
    >
      <p className={styles.reportNote}>{t('perfTolLead')}</p>
      <h3 className={styles.toleranceGroup}>{t('perfTolGroup_reference')}</h3>
      {FIELDS.slice(0, 4).map(field)}
      <h3 className={styles.toleranceGroup}>{t('perfTolGroup_rules')}</h3>
      {FIELDS.slice(4).map(field)}
    </Drawer>
  );
};

export default PerfTolerances;
