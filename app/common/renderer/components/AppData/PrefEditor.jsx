import {Alert, Button, Checkbox, Input, InputNumber, Modal, Select, Switch} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import styles from './AppData.module.css';

// the types each format can hold
const TYPES = {
  'shared-prefs': ['string', 'boolean', 'int', 'long', 'float', 'set'],
  datastore: ['string', 'boolean', 'int', 'long', 'float', 'double', 'set', 'data'],
  plist: ['string', 'boolean', 'int', 'double', 'date', 'data', 'array', 'dict'],
};

const emptyFor = (type) =>
  ({
    boolean: false,
    int: 0,
    long: '0',
    float: 0,
    double: 0,
    set: [],
    array: '[]',
    dict: '{}',
    date: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  })[type] ?? '';

// what the editor holds for a stored value: JSON as text, the rest as it is
const draftOf = (type, value) =>
  type === 'array' || type === 'dict' ? JSON.stringify(value ?? emptyFor(type), null, 2) : value;

/** The value to store from what the editor holds, or an error to show. */
export function valueFromDraft(type, draft) {
  if (type === 'array' || type === 'dict') {
    try {
      const parsed = JSON.parse(draft);
      const ok =
        type === 'array' ? Array.isArray(parsed) : parsed && typeof parsed === 'object' && !Array.isArray(parsed);
      return ok ? {value: parsed} : {error: 'dataEditBadJson'};
    } catch {
      return {error: 'dataEditBadJson'};
    }
  }
  if (type === 'long') {
    return /^-?\d+$/.test(String(draft).trim()) ? {value: String(draft).trim()} : {error: 'dataEditBadNumber'};
  }
  if (['int', 'float', 'double'].includes(type)) {
    const number = Number(draft);
    return Number.isFinite(number) && (type !== 'int' || Number.isInteger(number))
      ? {value: number}
      : {error: 'dataEditBadNumber'};
  }
  if (type === 'date') {
    return Number.isFinite(Date.parse(draft))
      ? {value: new Date(draft).toISOString().replace(/\.\d+Z$/, 'Z')}
      : {error: 'dataEditBadDate'};
  }
  return {value: draft};
}

const Editor = ({type, draft, onChange}) => {
  const {t} = useTranslation();
  if (type === 'boolean') {
    return <Switch checked={!!draft} onChange={onChange} />;
  }
  if (type === 'int' || type === 'float' || type === 'double') {
    return <InputNumber className={styles.wide} value={draft} onChange={onChange} step={type === 'int' ? 1 : 0.1} />;
  }
  if (type === 'set') {
    return (
      <Select
        mode="tags"
        className={styles.wide}
        value={draft ?? []}
        onChange={onChange}
        open={false}
        placeholder={t('dataEditSetHint')}
      />
    );
  }
  if (type === 'date') {
    return (
      <div className={styles.row}>
        <Input className={styles.mono} value={draft} onChange={(event) => onChange(event.target.value)} />
        <Button onClick={() => onChange(new Date().toISOString().replace(/\.\d+Z$/, 'Z'))}>{t('dataEditNow')}</Button>
      </div>
    );
  }
  return (
    <Input.TextArea
      className={styles.mono}
      value={draft}
      onChange={(event) => onChange(event.target.value)}
      autoSize={{minRows: type === 'array' || type === 'dict' ? 6 : 2, maxRows: 16}}
    />
  );
};

/**
 * Edits one key, or adds a new one, with an editor that fits its type. The
 * app is stopped for the write and started again unless unticked.
 */
const PrefEditor = ({open, format, entry, onCancel, onSave}) => {
  const {t} = useTranslation();
  const adding = !entry;
  const [key, setKey] = useState('');
  const [type, setType] = useState('string');
  const [draft, setDraft] = useState('');
  const [relaunch, setRelaunch] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setKey(entry?.key ?? '');
      setType(entry?.type ?? 'string');
      setDraft(draftOf(entry?.type ?? 'string', entry ? entry.value : ''));
      setError(null);
      setSaving(false);
    }
  }, [open, entry]);

  const save = async () => {
    if (!key.trim()) {
      setError(t('dataEditNoKey'));
      return;
    }
    const parsed = valueFromDraft(type, draft);
    if (parsed.error) {
      setError(t(parsed.error));
      return;
    }
    setSaving(true);
    const result = await onSave({key: key.trim(), type, value: parsed.value, relaunch});
    setSaving(false);
    if (result && !result.ok) {
      setError(result.error);
    }
  };

  return (
    <Modal
      open={open}
      title={adding ? t('dataEditAdd') : t('dataEditTitle')}
      onCancel={onCancel}
      onOk={save}
      okText={t('dataEditSave')}
      cancelText={t('dataCancel')}
      confirmLoading={saving}
      destroyOnHidden
    >
      <div className={styles.form}>
        <label className={styles.field}>
          <span>{t('dataKey')}</span>
          <Input
            className={styles.mono}
            value={key}
            disabled={!adding}
            onChange={(event) => setKey(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>{t('dataType')}</span>
          <Select
            value={type}
            disabled={!adding}
            onChange={(next) => {
              setType(next);
              setDraft(draftOf(next, emptyFor(next)));
            }}
            options={(TYPES[format] ?? TYPES['shared-prefs']).map((value) => ({value, label: value}))}
          />
        </label>
        <label className={styles.field}>
          <span>{t('dataValue')}</span>
          <Editor type={type} draft={draft} onChange={setDraft} />
        </label>
        <Checkbox checked={relaunch} onChange={(event) => setRelaunch(event.target.checked)}>
          {t('dataRelaunch')}
        </Checkbox>
        <p className={styles.hint}>{t('dataEditStopHint')}</p>
        {error && <Alert type="error" showIcon title={error} />}
      </div>
    </Modal>
  );
};

export default PrefEditor;
