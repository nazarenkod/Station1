/**
 * Why the device's apps could not be read, in words a tester can act on.
 */
export const appsProblemText = (error, t) =>
  t(`wsAppsError_${error.reason}`, {
    xcode: error.xcode || '?',
    ios: error.ios || '?',
    message: error.message ?? '',
    defaultValue: error.message ?? t('wsAppsError_failed'),
  });

export const appVersionLabel = (app) => [app?.version, app?.build && `(${app.build})`].filter(Boolean).join(' ');
