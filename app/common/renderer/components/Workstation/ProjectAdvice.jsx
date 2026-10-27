import {Button} from 'antd';
import {useTranslation} from 'react-i18next';
import {useNavigate} from 'react-router';

import {setProfilePlatforms, switchProfile, useProfiles} from '../../lib/settings/profiles-store.js';
import {adviceFocus, adviceText} from '../../lib/settings/project-advice.js';

/**
 * The ways out of an advice about the project: add the device's platform to
 * the project, go to the profile that has it, or set the missing app — each
 * straight to its field.
 */
export const AdviceActions = ({advice, size = 'middle', primary = true}) => {
  const {t} = useTranslation();
  const navigate = useNavigate();
  const profiles = useProfiles();
  if (!advice) {
    return null;
  }
  const platform = t(`settingsPlatform_${advice.platform}`);
  const open = () => navigate('/settings', {state: adviceFocus(advice)});
  if (advice.kind === 'noApp') {
    return (
      <Button size={size} type={primary ? 'primary' : 'default'} onClick={open}>
        {t('projectAdviceSetApp', {platform})}
      </Button>
    );
  }
  const profile = profiles.list?.find((one) => one.id === profiles.activeId);
  return (
    <>
      {advice.other && (
        <Button size={size} type={primary ? 'primary' : 'default'} onClick={() => switchProfile(advice.other.id)}>
          {t('projectAdviceSwitch', {name: advice.other.name})}
        </Button>
      )}
      <Button
        size={size}
        type={primary && !advice.other ? 'primary' : 'default'}
        onClick={async () => {
          await setProfilePlatforms(profile.id, [...(profile.platforms ?? []), advice.platform]);
          open();
        }}
      >
        {t('projectAdviceAddPlatform', {platform})}
      </Button>
    </>
  );
};

/** The advice as a sentence with its ways out, for an empty tool. */
const ProjectAdvice = ({advice, className}) => {
  const {t} = useTranslation();
  if (!advice) {
    return null;
  }
  return (
    <div className={className}>
      <p>{adviceText(t, advice)}</p>
      <div>
        <AdviceActions advice={advice} />
      </div>
    </div>
  );
};

export default ProjectAdvice;
