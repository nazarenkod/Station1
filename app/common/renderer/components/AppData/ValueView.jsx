import {IconBraces, IconClock, IconCopy, IconKey, IconLink, IconLock} from '@tabler/icons-react';
import {Button, Drawer, Tooltip} from 'antd';
import {useMemo} from 'react';
import {useTranslation} from 'react-i18next';

import {recognize, valueText} from '../../../shared/app-data/values.js';
import {openLink} from '../../polyfills.js';
import {formatMoment, formatRelative} from './format.js';

import styles from './AppData.module.css';

const copy = (text) => navigator.clipboard?.writeText(text);

/**
 * The badge next to a value the station recognised: a JWT with when it
 * expires, JSON, a moment, base64 text, a link.
 */
export const ValueBadge = ({found}) => {
  const {t} = useTranslation();
  if (!found) {
    return null;
  }
  if (found.kind === 'jwt') {
    const expired = found.expiresIn !== null && found.expiresIn < 0;
    const label =
      found.exp === null
        ? t('dataJwtNoExp')
        : expired
          ? t('dataJwtExpired', {when: formatRelative(t, found.exp)})
          : t('dataJwtExpires', {when: formatRelative(t, found.exp)});
    return (
      <span className={`${styles.badge} ${expired ? styles.badgeBad : styles.badgeJwt}`}>
        <IconKey size={12} />
        JWT · {label}
      </span>
    );
  }
  if (found.kind === 'json') {
    return (
      <span className={styles.badge}>
        <IconBraces size={12} />
        JSON
      </span>
    );
  }
  if (found.kind === 'time') {
    return (
      <Tooltip title={formatRelative(t, found.ms)}>
        <span className={styles.badge}>
          <IconClock size={12} />
          {formatMoment(found.ms)}
        </span>
      </Tooltip>
    );
  }
  if (found.kind === 'base64') {
    return (
      <Tooltip title={found.text.slice(0, 200)}>
        <span className={styles.badge}>base64 → {found.text.slice(0, 24)}</span>
      </Tooltip>
    );
  }
  if (found.kind === 'url') {
    return (
      <span className={styles.badge}>
        <IconLink size={12} />
        URL
      </span>
    );
  }
  return null;
};

/** A value in one line, with its badge; a click opens it whole. */
export const ValueCell = ({value, type, encrypted, onOpen}) => {
  const found = useMemo(() => (encrypted ? null : recognize(value, {type})), [value, type, encrypted]);
  if (encrypted) {
    return (
      <span className={styles.valueEncrypted}>
        <IconLock size={12} /> {valueText(value).slice(0, 48)}
      </span>
    );
  }
  if (type === 'boolean') {
    return <span className={value ? styles.valueTrue : styles.valueFalse}>{String(value)}</span>;
  }
  const text = valueText(value);
  return (
    <span className={styles.valueCell}>
      <button type="button" className={styles.valueText} onClick={onOpen} title={text.slice(0, 500)}>
        {text === '' ? <span className={styles.empty}>&quot;&quot;</span> : text}
      </button>
      <ValueBadge found={found} />
    </span>
  );
};

const Block = ({title, text}) => {
  const {t} = useTranslation();
  return (
    <section className={styles.drawerBlock}>
      <header>
        <span>{title}</span>
        <Button size="small" type="text" icon={<IconCopy size={14} />} onClick={() => copy(text)}>
          {t('dataCopy')}
        </Button>
      </header>
      <pre className={styles.pre}>{text}</pre>
    </section>
  );
};

/** A value whole: as it is stored, and as the station reads it. */
export const ValueDrawer = ({open, onClose, title, value, type}) => {
  const {t} = useTranslation();
  const raw = valueText(value);
  const found = open ? recognize(value, {type}) : null;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={<span className={styles.mono}>{title}</span>}
      size={560}
      destroyOnHidden
    >
      <div className={styles.drawerBody}>
        {found && (
          <div>
            <ValueBadge found={found} />
          </div>
        )}
        {found?.kind === 'jwt' && (
          <>
            <Block title={t('dataJwtHeader')} text={JSON.stringify(found.header, null, 2)} />
            <Block title={t('dataJwtPayload')} text={JSON.stringify(found.payload, null, 2)} />
          </>
        )}
        {found?.kind === 'json' && <Block title={t('dataAsJson')} text={JSON.stringify(found.value, null, 2)} />}
        {found?.kind === 'base64' && <Block title={t('dataAsText')} text={found.text} />}
        {found?.kind === 'url' && (
          <Button type="link" icon={<IconLink size={14} />} onClick={() => openLink(found.href)}>
            {found.href}
          </Button>
        )}
        {found?.kind === 'time' && (
          <Block title={t('dataAsTime')} text={`${formatMoment(found.ms)}\n${formatRelative(t, found.ms)}`} />
        )}
        <Block
          title={t('dataRaw')}
          text={typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : raw}
        />
      </div>
    </Drawer>
  );
};
