import {Input, Modal} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {violationText} from './a11y-ui.js';

const JIRA_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;

/**
 * Asks for what a decision needs: a reason to ignore, or the key of the Jira
 * issue that already covers the problem.
 */
const DecisionModal = ({decision, onCancel, onConfirm}) => {
  const {t} = useTranslation();
  const [value, setValue] = useState('');
  const isLink = decision?.kind === 'link';

  useEffect(() => setValue(''), [decision]);

  const key = value.trim().toUpperCase();
  const valid = !isLink || JIRA_KEY.test(key);

  return (
    <Modal
      open={!!decision}
      title={isLink ? t('a11yLinkJiraTitle') : t('a11yIgnoreTitle')}
      okText={isLink ? t('a11yLinkJira') : t('a11yIgnore')}
      okButtonProps={{disabled: !valid}}
      onCancel={onCancel}
      onOk={() => onConfirm(isLink ? key : value.trim())}
      destroyOnHidden
      centered
    >
      {decision && <p>{violationText(t, decision.violation).title}</p>}
      {isLink ? (
        <Input
          autoFocus
          value={value}
          placeholder={t('a11yLinkJiraPlaceholder')}
          onChange={(e) => setValue(e.target.value)}
          onPressEnter={() => valid && onConfirm(key)}
        />
      ) : (
        <Input.TextArea
          autoFocus
          value={value}
          rows={3}
          placeholder={t('a11yIgnoreComment')}
          onChange={(e) => setValue(e.target.value)}
        />
      )}
    </Modal>
  );
};

export default DecisionModal;
