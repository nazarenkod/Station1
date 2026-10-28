import {Input, Modal} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

/**
 * Asks for a name: for a new project, a copy, or a new name.
 */
const NameDialog = ({open, title, initial = '', onOk, onCancel}) => {
  const {t} = useTranslation();
  const [name, setName] = useState(initial);
  // a fresh name each time it opens, before anything is typed
  useEffect(() => {
    if (open) {
      setName(initial);
    }
  }, [open, initial]);
  return (
    <Modal
      open={open}
      title={title}
      okText={t('settingsProfileSave')}
      okButtonProps={{disabled: !name.trim()}}
      onOk={() => onOk(name.trim())}
      cancelText={t('Cancel')}
      onCancel={onCancel}
      destroyOnHidden
    >
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onPressEnter={() => name.trim() && onOk(name.trim())}
      />
    </Modal>
  );
};

export default NameDialog;
