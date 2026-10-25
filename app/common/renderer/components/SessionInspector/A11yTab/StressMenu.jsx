import {IconBolt, IconMoon, IconRotate, IconTextIncrease} from '@tabler/icons-react';
import {Button, Dropdown, Tooltip} from 'antd';
import {useTranslation} from 'react-i18next';

const MODES = [
  {key: 'dark', icon: IconMoon},
  {key: 'fontScale', icon: IconTextIncrease},
  {key: 'landscape', icon: IconRotate},
];

/**
 * Re-checks the screen with the device in a harder setting: dark theme,
 * largest font, landscape.
 */
const StressMenu = ({startA11yStress, a11yStress}) => {
  const {t} = useTranslation();
  const items = MODES.map(({key, icon: Icon}) => ({
    key,
    icon: <Icon size={16} />,
    label: t(`a11yStress_${key}`),
    disabled: a11yStress?.mode === key,
    onClick: () => startA11yStress(key),
  }));
  return (
    <Dropdown menu={{items}} trigger={['click']}>
      <Tooltip title={t('a11yStress')}>
        <Button icon={<IconBolt size={16} />} type={a11yStress ? 'primary' : 'default'} ghost={!!a11yStress} />
      </Tooltip>
    </Dropdown>
  );
};

export default StressMenu;
