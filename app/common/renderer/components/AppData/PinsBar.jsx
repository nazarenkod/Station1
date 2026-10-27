import {IconFile, IconStarFilled, IconX} from '@tabler/icons-react';
import {App, Switch, Tooltip} from 'antd';
import {useTranslation} from 'react-i18next';

import {flutterKey} from '../../../shared/app-data/prefs-android.js';
import {setPref} from './app-data-store.js';
import {formatSize} from './format.js';
import {ValueCell} from './ValueView.jsx';

import styles from './AppData.module.css';

/**
 * The keys and files the project pinned, at the top of the tab, each with
 * its value now; a flag switches with one click.
 */
const PinsBar = ({pins, snapshot, marks, onOpen, onUnpin}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  if (!pins.length) {
    return null;
  }

  const flip = async (pin, entry) => {
    const result = await setPref(pin.file, pin.key, !entry.value, 'boolean');
    if (result?.ok) {
      message.success(t('dataSaved', {key: pin.key}));
    } else {
      message.error(result?.error ?? t('dataFailed'));
    }
  };

  return (
    <div className={styles.pins}>
      {pins.map((pin) => {
        const id = `${pin.file}|${pin.key ?? ''}`;
        if (pin.key === undefined) {
          const file = snapshot?.files.find((one) => one.path === pin.file);
          return (
            <div
              key={id}
              className={`${styles.pinCard} ${marks[`files|${pin.file}`] ? styles[`mark_${marks[`files|${pin.file}`]}`] : ''}`}
            >
              <button
                type="button"
                className={styles.pinTitle}
                onClick={() => onOpen({section: 'files', file: pin.file})}
              >
                <IconFile size={13} /> {pin.file.split('/').at(-1)}
              </button>
              <span className={styles.pinValue}>{file ? formatSize(file.size) : t('dataPinMissing')}</span>
              <button type="button" className={styles.pinRemove} onClick={() => onUnpin(pin)} title={t('dataUnpin')}>
                <IconX size={12} />
              </button>
            </div>
          );
        }
        const prefs = snapshot?.prefs.find((one) => one.file === pin.file);
        const entry = prefs?.entries.find((one) => one.key === pin.key);
        const mark = marks[`prefs|${pin.file}|${pin.key}`];
        return (
          <div key={id} className={`${styles.pinCard} ${mark ? styles[`mark_${mark}`] : ''}`}>
            <Tooltip title={pin.file}>
              <button
                type="button"
                className={styles.pinTitle}
                onClick={() => onOpen({section: 'prefs', file: pin.file, key: pin.key})}
              >
                <IconStarFilled size={12} className={styles.pinStar} /> {flutterKey(pin.key).name}
              </button>
            </Tooltip>
            <span className={styles.pinValue}>
              {!entry ? (
                <span className={styles.muted}>{t('dataPinMissing')}</span>
              ) : entry.type === 'boolean' ? (
                <Switch size="small" checked={!!entry.value} onChange={() => flip(pin, entry)} />
              ) : (
                <ValueCell
                  value={entry.value}
                  type={entry.type}
                  onOpen={() => onOpen({section: 'prefs', file: pin.file, key: pin.key})}
                />
              )}
            </span>
            <button type="button" className={styles.pinRemove} onClick={() => onUnpin(pin)} title={t('dataUnpin')}>
              <IconX size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default PinsBar;
