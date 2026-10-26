import {App, ConfigProvider, Layout} from 'antd';
import {MotionConfig} from 'motion/react';
import {createContext, useEffect, useMemo, useState} from 'react';

import {PREFERRED_THEME} from '../../shared/setting-defs.js';
import Notification from '../components/Notification.jsx';
import {backend, getSetting, setSetting, setTheme} from '../polyfills.js';
import {buildThemeConfig} from '../theme/brand.js';

import darkTheme from '../assets/stylesheets/prism-dark.css?url';
import lightTheme from '../assets/stylesheets/prism-light.css?url';

const systemPrefersDarkTheme = window.matchMedia('(prefers-color-scheme: dark)').matches;
const savedTheme = await getSetting(PREFERRED_THEME);
setTheme(savedTheme);

const loadHighlightTheme = (isDarkTheme) => {
  const linkId = 'highlight-theme';
  let link = document.getElementById(linkId);

  if (!link) {
    link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    link.type = 'text/css';
    document.head.appendChild(link);
  }

  if (isDarkTheme) {
    link.href = darkTheme;
  } else {
    link.href = lightTheme;
  }
};

export const ThemeContext = createContext(null);

export const ThemeProvider = ({children}) => {
  const [preferredTheme, setPreferredTheme] = useState(savedTheme);

  // an import or a restored backup can bring another theme
  useEffect(
    () =>
      backend.settings?.onChanged(async ({keys}) => {
        if (keys.includes(PREFERRED_THEME)) {
          const theme = await getSetting(PREFERRED_THEME);
          setTheme(theme);
          setPreferredTheme(theme);
        }
      }),
    [],
  );

  const isDarkTheme = preferredTheme === 'dark' || (preferredTheme === 'system' && systemPrefersDarkTheme);

  loadHighlightTheme(isDarkTheme);

  const handleDarkClass = () => {
    if (isDarkTheme) {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
  };

  handleDarkClass();

  const updateTheme = async (theme) => {
    setTheme(theme);
    setPreferredTheme(theme);
    await setSetting(PREFERRED_THEME, theme);
  };

  const themeConfig = useMemo(() => buildThemeConfig(isDarkTheme), [isDarkTheme]);

  const themeContext = useMemo(() => ({updateTheme, preferredTheme, isDarkTheme}), [preferredTheme, isDarkTheme]);

  return (
    <ThemeContext value={themeContext}>
      <ConfigProvider theme={themeConfig}>
        {/* animations follow the system "reduce motion" setting */}
        <MotionConfig reducedMotion="user">
          <App>
            <Layout>{children}</Layout>
            <Notification />
          </App>
        </MotionConfig>
      </ConfigProvider>
    </ThemeContext>
  );
};
