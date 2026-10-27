import {useSelector} from 'react-redux';

import {platformOfDevice, projectAdvice} from '../../../shared/settings/platforms.js';
import {activeDevice} from '../../actions/Workstation.js';
import {useProfiles} from './profiles-store.js';

/**
 * What the person is told about the project and the device on the title
 * bar, the same in every tool: the project is not for this platform, or its
 * app there is not set (project.platforms).
 */
export function useProjectAdvice() {
  const profiles = useProfiles();
  const device = useSelector((state) => activeDevice(state.workstation));
  const profile = profiles.list?.find((one) => one.id === profiles.activeId) ?? null;
  return projectAdvice({profile, profiles: profiles.list ?? [], devicePlatform: platformOfDevice(device)});
}

/** The advice as one sentence. */
export function adviceText(t, advice) {
  if (!advice) {
    return '';
  }
  const platform = t(`settingsPlatform_${advice.platform}`);
  return advice.kind === 'noPlatform'
    ? t('projectAdviceNoPlatform', {project: advice.project, only: t(`settingsPlatform_${advice.only}`), platform})
    : t('projectAdviceNoApp', {platform});
}

/** Where the settings open to fix it: the profiles, the platform's tab, the field. */
export const adviceFocus = (advice) => ({
  section: 'profiles',
  focus: {field: 'app', platform: advice.kind === 'noApp' ? advice.section : advice.platform},
});
