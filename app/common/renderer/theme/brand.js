import {theme} from 'antd';

// The Vision palette: a violet-to-cyan lens gradient over quiet neutral surfaces
export const BRAND = {
  violet: '#7C5CFF',
  blue: '#3B82F6',
  cyan: '#22D3EE',
  gradient: 'linear-gradient(135deg, #7C5CFF 0%, #3B82F6 55%, #22D3EE 100%)',
};

const SURFACES = {
  dark: {
    layout: '#0B0B10',
    container: '#13131A',
    elevated: '#1A1A24',
    border: '#272734',
    borderSecondary: '#1F1F2A',
    text: '#ECECF3',
    selected: 'rgba(124, 92, 255, 0.22)',
  },
  light: {
    layout: '#F5F5FA',
    container: '#FFFFFF',
    elevated: '#FFFFFF',
    border: '#E3E3EC',
    borderSecondary: '#EEEEF4',
    text: '#16161D',
    selected: 'rgba(124, 92, 255, 0.12)',
  },
};

export const FONT_FAMILY =
  "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
export const FONT_FAMILY_CODE =
  "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

/**
 * The antd theme for one colour scheme.
 */
export function buildThemeConfig(isDarkTheme) {
  const surface = isDarkTheme ? SURFACES.dark : SURFACES.light;
  return {
    algorithm: isDarkTheme ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: BRAND.violet,
      colorInfo: BRAND.blue,
      colorSuccess: '#22C55E',
      colorWarning: '#F59E0B',
      colorError: '#F43F5E',
      colorLink: BRAND.violet,
      colorBgLayout: surface.layout,
      colorBgContainer: surface.container,
      colorBgElevated: surface.elevated,
      colorBorder: surface.border,
      colorBorderSecondary: surface.borderSecondary,
      colorText: surface.text,
      fontFamily: FONT_FAMILY,
      fontFamilyCode: FONT_FAMILY_CODE,
      fontSize: 13,
      borderRadius: 10,
      borderRadiusLG: 14,
      borderRadiusSM: 7,
      controlHeight: 34,
      wireframe: false,
      motionDurationMid: '0.22s',
      motionEaseInOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
      motionEaseOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
      boxShadowSecondary: isDarkTheme
        ? '0 12px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.04)'
        : '0 12px 40px rgba(20, 20, 50, 0.12), 0 0 0 1px rgba(20, 20, 50, 0.04)',
    },
    components: {
      Badge: {
        colorError: BRAND.violet,
        indicatorHeight: 20,
        textFontSize: 12,
      },
      Button: {
        fontWeight: 500,
        primaryShadow: '0 6px 20px rgba(124, 92, 255, 0.35)',
        defaultShadow: 'none',
        dangerShadow: 'none',
      },
      Card: {
        headerFontSize: 14,
        headerBg: 'transparent',
      },
      Collapse: {
        headerBg: 'transparent',
      },
      Modal: {
        borderRadiusLG: 18,
      },
      Notification: {
        borderRadiusLG: 14,
      },
      Switch: {
        handleSize: 18,
        trackHeight: 22,
        trackMinWidth: 44,
      },
      Table: {
        headerBg: 'transparent',
        headerColor: isDarkTheme ? 'rgba(236, 236, 243, 0.55)' : 'rgba(22, 22, 29, 0.55)',
        headerSplitColor: 'transparent',
        rowSelectedBg: surface.selected,
        rowHoverBg: isDarkTheme ? 'rgba(255, 255, 255, 0.03)' : 'rgba(22, 22, 29, 0.025)',
      },
      Tabs: {
        titleFontSize: 14,
        inkBarColor: BRAND.violet,
        itemSelectedColor: isDarkTheme ? '#FFFFFF' : '#16161D',
        itemColor: isDarkTheme ? 'rgba(236, 236, 243, 0.6)' : 'rgba(22, 22, 29, 0.6)',
      },
      Tag: {
        borderRadiusSM: 6,
      },
      Tree: {
        nodeSelectedBg: surface.selected,
      },
    },
  };
}
