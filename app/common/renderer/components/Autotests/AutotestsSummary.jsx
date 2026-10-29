import {IconArrowsSplit2, IconCheck, IconFileCode, IconStack2} from '@tabler/icons-react';
import {App, Button, Checkbox, Drawer, Input, Tooltip} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useNavigate} from 'react-router';

import {mergeElements} from '../../../shared/autotests/screen-objects.js';
import {initialUnits, mergeUnits, setUnit, splitUnit, uniqueNames} from '../../../shared/autotests/units.js';
import {screenElements} from '../../lib/autotests/screen-elements.js';
import {closeSummary, useAutotestsSummary} from '../../lib/autotests/summary-store.js';
import {useProfiles} from '../../lib/settings/profiles-store.js';
import {backend} from '../../polyfills.js';

import styles from './Autotests.module.css';

// the screens as the summary shows them: a state is called as in the strip of screens
const withTitles = (screens, t) =>
  screens.map((screen) => ({
    ...screen,
    title: screen.title ?? t('a11yScreenUnknown'),
    states: screen.states.map((state) => ({
      ...state,
      title: state.title ?? (state.number > 1 ? t('a11yStateNumber', {number: state.number}) : t('a11yStateFirst')),
    })),
  }));

/** One screen object to be: its states, whether it is chosen, its name. */
const UnitCard = ({unit, screen, onChange, onSplit}) => {
  const {t} = useTranslation();
  const states = unit.stateIds.map((id) => screen.states.find((state) => state.id === id)).filter(Boolean);
  const merged = states.length > 1;
  return (
    <div className={`${styles.unit} ${unit.chosen ? styles.unitChosen : ''}`}>
      <Checkbox checked={unit.chosen} onChange={(e) => onChange({chosen: e.target.checked})} />
      <div className={styles.unitThumbs}>
        {states.map((state) =>
          state.thumb ? (
            <img key={state.id} className={styles.thumb} src={state.thumb} alt="" />
          ) : (
            <span key={state.id} className={styles.thumb} />
          ),
        )}
      </div>
      <div className={styles.unitText}>
        <span className={styles.unitStates}>
          {merged && <IconStack2 size={12} aria-hidden="true" />}
          {states.map((state) => state.title).join(' + ')}
        </span>
        {unit.chosen && (
          <Input
            size="small"
            className={styles.mono}
            value={unit.name}
            aria-label={t('autotestsObjectName')}
            onChange={(e) => onChange({name: e.target.value})}
          />
        )}
      </div>
      {merged && (
        <Tooltip title={t('autotestsSplit')}>
          <Button
            size="small"
            type="text"
            icon={<IconArrowsSplit2 size={14} />}
            aria-label={t('autotestsSplit')}
            onClick={onSplit}
          />
        </Tooltip>
      )}
    </div>
  );
};

/**
 * «Summary for autotests»: after a session, the states of its screens to
 * pick, alone or merged with other states of the same screen, and keep as a
 * package of screen objects in the project. Every element of a state goes
 * in; a person drops what is not needed later, in the code.
 */
const AutotestsSummary = () => {
  const {t} = useTranslation();
  const {message, modal} = App.useApp();
  const navigate = useNavigate();
  const {open, flow, context} = useAutotestsSummary();
  const profiles = useProfiles();
  const [units, setUnits] = useState([]);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const screens = flow ? withTitles(flow.screens, t) : [];

  useEffect(() => {
    if (flow) {
      setUnits(initialUnits(withTitles(flow.screens, t)));
      setName(
        `${context?.app?.id ?? t('autotestsPackage')} · ${new Date().toLocaleString([], {dateStyle: 'short', timeStyle: 'short'})}`,
      );
    }
    // a new flow starts the choice over; the language does not
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [flow]);

  if (!backend?.autotests) {
    return null;
  }
  const chosen = units.filter((unit) => unit.chosen);
  const project = profiles.list.find((profile) => profile.id === profiles.activeId);

  const close = () => {
    if (!chosen.length) {
      closeSummary();
      return;
    }
    modal.confirm({
      title: t('autotestsCloseAsk'),
      content: t('autotestsCloseHint'),
      okText: t('autotestsCloseOk'),
      okButtonProps: {danger: true},
      cancelText: t('Cancel'),
      onOk: closeSummary,
    });
  };

  // states of one screen chosen together can be merged
  const mergeable = [...new Set(chosen.map((unit) => unit.screenKey))]
    .map((key) => chosen.filter((unit) => unit.screenKey === key))
    .find((list) => list.length > 1);

  const save = async () => {
    setSaving(true);
    // the elements are read from the trees here; let the button show it is busy first
    await new Promise((resolve) => setTimeout(resolve, 30));
    try {
      const objects = uniqueNames(units)
        .filter((unit) => unit.chosen)
        .map((unit) => {
          const screen = screens.find((one) => one.key === unit.screenKey);
          const states = unit.stateIds.map((id) => screen.states.find((state) => state.id === id)).filter(Boolean);
          return {
            name: unit.name,
            screen: screen.title,
            states: states.map((state) => ({title: state.title, shot: state.reduced ?? null})),
            elements: mergeElements(
              states.map((state) => ({
                id: state.id,
                title: state.title,
                elements: screenElements(state.sourceXML, context?.platform ?? 'android'),
              })),
            ),
          };
        });
      const saved = await backend.autotests.save({
        name: name.trim() || t('autotestsPackage'),
        platform: context?.platform ?? 'android',
        device: context?.device ?? null,
        app: context?.app ?? null,
        objects,
      });
      closeSummary();
      message.success({
        content: (
          <span>
            {t('autotestsSaved', {count: saved.objects})}{' '}
            <Button
              size="small"
              type="link"
              onClick={() => navigate('/projects', {state: {focus: {field: 'autotests'}}})}
            >
              {t('autotestsOpenInProject')}
            </Button>
          </span>
        ),
      });
    } catch (error) {
      message.error(t('autotestsSaveFailed', {reason: error.message}));
    } finally {
      setSaving(false);
    }
  };

  const unnamed = screens.filter((screen) => !screen.named);

  return (
    <Drawer
      open={open}
      onClose={close}
      size={560}
      title={
        <span className={styles.drawerTitle}>
          <IconFileCode size={18} stroke={1.7} />
          {t('autotestsSummaryTitle')}
        </span>
      }
      footer={
        <div className={styles.footer}>
          <span className={styles.hint}>{project ? t('autotestsSaveTo', {project: project.name}) : null}</span>
          <Button onClick={close}>{t('autotestsLater')}</Button>
          <Button
            type="primary"
            icon={<IconCheck size={14} />}
            disabled={!chosen.length}
            loading={saving}
            onClick={save}
          >
            {t('autotestsSave', {count: chosen.length})}
          </Button>
        </div>
      }
      destroyOnHidden
    >
      <div className={styles.summary}>
        <p className={styles.hint}>{t('autotestsSummaryHint')}</p>
        <label className={styles.pathRow}>
          <span>{t('autotestsPackageName')}</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {mergeable && (
          <div className={styles.mergeBar}>
            <span>
              {t('autotestsMergeAsk', {
                count: mergeable.length,
                screen: screens.find((screen) => screen.key === mergeable[0].screenKey)?.title,
              })}
            </span>
            <Button
              size="small"
              icon={<IconStack2 size={14} />}
              onClick={() =>
                setUnits(
                  mergeUnits(
                    units,
                    mergeable.map((unit) => unit.key),
                    screens.find((screen) => screen.key === mergeable[0].screenKey)?.title,
                  ),
                )
              }
            >
              {t('autotestsMerge')}
            </Button>
          </div>
        )}
        {screens
          .filter((screen) => screen.named && screen.states.length)
          .map((screen) => (
            <section key={screen.key} className={styles.screen} aria-label={screen.title}>
              <h3 className={styles.screenTitle}>{screen.title}</h3>
              {units
                .filter((unit) => unit.screenKey === screen.key)
                .map((unit) => (
                  <UnitCard
                    key={unit.key}
                    unit={unit}
                    screen={screen}
                    onChange={(patch) => setUnits((list) => setUnit(list, unit.key, patch))}
                    onSplit={() => setUnits((list) => splitUnit(list, unit.key, screen))}
                  />
                ))}
            </section>
          ))}
        {unnamed.length > 0 && <p className={styles.hint}>{t('autotestsUnnamed', {count: unnamed.length})}</p>}
      </div>
    </Drawer>
  );
};

export default AutotestsSummary;
