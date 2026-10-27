import {Button, Input, Select, Tag} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';

import {MAX_NOTE, NOTE_KINDS, NOTE_SCOPES} from '../../../shared/agent/memory.js';
import {dismissProposal, saveProposal} from '../../lib/agent/agent-store.js';

import styles from './Agent.module.css';

/**
 * A note waiting for the person: from the agent, a rollback, «Noise» on the
 * task's checklist or «Remember». The text, kind and scope can be changed;
 * nothing is kept without «Save».
 */
const MemoryCard = ({proposal}) => {
  const {t} = useTranslation();
  const [note, setNote] = useState(proposal.note);
  const save = (options) => saveProposal(proposal.id, note, {replace: proposal.replaces, ...options});
  const tags = Object.entries(note.tags ?? {});

  return (
    <div className={styles.card}>
      <b>{proposal.note.text ? t('memoryProposalTitle') : t('memoryDraftTitle')}</b>
      {proposal.hint && <span className={styles.muted}>{proposal.hint}</span>}
      <Input.TextArea
        value={note.text}
        maxLength={MAX_NOTE}
        showCount
        autoSize={{minRows: 2, maxRows: 5}}
        onChange={(e) => setNote({...note, text: e.target.value})}
        placeholder={t('memoryTextPlaceholder')}
      />
      <div className={styles.cardActions}>
        <Select
          size="small"
          value={note.kind}
          onChange={(kind) => setNote({...note, kind})}
          options={NOTE_KINDS.map((kind) => ({value: kind, label: t(`memoryKind_${kind}`)}))}
        />
        <Select
          size="small"
          value={note.scope}
          onChange={(scope) => setNote({...note, scope})}
          options={NOTE_SCOPES.map((scope) => ({value: scope, label: t(`memoryScope_${scope}`)}))}
        />
        {tags.map(([kind, value]) => (
          <Tag
            key={kind}
            closable
            onClose={() => {
              const {[kind]: _gone, ...rest} = note.tags;
              setNote({...note, tags: rest});
            }}
          >
            {t(`memoryTag_${kind}`)}: {value}
          </Tag>
        ))}
      </div>
      {proposal.error && proposal.error !== 'similar' && (
        <span className={styles.warn}>
          {t(`memoryError_${proposal.error}`, {defaultValue: t('memoryError_other')})}
        </span>
      )}
      {proposal.similar && <span className={styles.muted}>{t('memorySimilar', {text: proposal.similar.text})}</span>}
      <div className={styles.cardActions}>
        {proposal.similar ? (
          <>
            <Button size="small" type="primary" onClick={() => save({replace: proposal.similar.id})}>
              {t('memoryReplace')}
            </Button>
            <Button size="small" onClick={() => save({keepBoth: true})}>
              {t('memoryKeepBoth')}
            </Button>
          </>
        ) : (
          <Button size="small" type="primary" disabled={!note.text.trim()} onClick={() => save()}>
            {t('memorySave')}
          </Button>
        )}
        <Button size="small" onClick={() => dismissProposal(proposal.id)}>
          {t('memoryReject')}
        </Button>
      </div>
    </div>
  );
};

export default MemoryCard;
