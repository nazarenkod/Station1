import {theme} from 'antd';

// The Vision palette: one violet accent over quiet, near-black (or paper) surfaces.
// The CSS side of the same tokens lives in assets/stylesheets/main.css as --vi-*;
// keep the two in step.
export const BRAND = {
  violet: '#7C5CFF',
  blue: '#3B82F6',
  cyan: '#22D3EE',
  gradient: 'linear-gradient(135deg, #7050FF 0%, #4F5FE8 55%, #2F6FE0 100%)',
};

// the primary colour is a shade deeper than the brand violet so white text on it passes 4.5:1
const PRIMARY = '#7050FF';

const SCHEMES = {
  dark: {
    layout: '#09090D',
    container: '#111117',
    elevated: '#17171F',
    border: '#262631',
    borderSecondary: '#1C1C25',
    text: '#F2F2F7',
    textSecondary: '#B4B4C6',
    textTertiary: '#8E8EA3',
    textQuaternary: '#6E6E84',
    selected: 'rgba(124, 92, 255, 0.18)',
    hover: 'rgba(255, 255, 255, 0.035)',
    success: '#4ADE80',
    warning: '#FBBF24',
    error: '#FB7185',
    info: '#60A5FA',
    link: '#A797FF',
    shadow: '0 16px 48px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.06)',
  },
  light: {
    layout: '#F5F5F8',
    container: '#FFFFFF',
    elevated: '#FFFFFF',
    border: '#E0E0E8',
    borderSecondary: '#EBEBF1',
    text: '#121218',
    textSecondary: '#4A4A5C',
    textTertiary: '#6B6B80',
    textQuaternary: '#858599',
    selected: 'rgba(124, 92, 255, 0.1)',
    hover: 'rgba(18, 18, 24, 0.03)',
    success: '#16A34A',
    warning: '#D97706',
    error: '#E11D48',
    info: '#2563EB',
    link: '#5A3EE6',
    shadow: '0 16px 48px rgba(16, 16, 40, 0.12), 0 0 0 1px rgba(16, 16, 40, 0.05)',
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
  const scheme = isDarkTheme ? SCHEMES.dark : SCHEMES.light;
  return {
    algorithm: isDarkTheme ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: PRIMARY,
      colorInfo: scheme.info,
      colorSuccess: scheme.success,
      colorWarning: scheme.warning,
      colorError: scheme.error,
      colorLink: scheme.link,
      colorBgLayout: scheme.layout,
      colorBgContainer: scheme.container,
      colorBgElevated: scheme.elevated,
      colorBorder: scheme.border,
      colorBorderSecondary: scheme.borderSecondary,
      colorSplit: scheme.borderSecondary,
      colorText: scheme.text,
      colorTextSecondary: scheme.textSecondary,
      colorTextTertiary: scheme.textTertiary,
      colorTextQuaternary: scheme.textQuaternary,
      colorTextPlaceholder: scheme.textQuaternary,
      colorTextDescription: scheme.textTertiary,
      fontFamily: FONT_FAMILY,
      fontFamilyCode: FONT_FAMILY_CODE,
      fontSize: 13,
      borderRadius: 10,
      borderRadiusLG: 16,
      borderRadiusSM: 8,
      borderRadiusXS: 6,
      controlHeight: 34,
      wireframe: false,
      motionDurationMid: '0.2s',
      motionEaseInOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
      motionEaseOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
      boxShadowSecondary: scheme.shadow,
    },
    components: {
      Alert: {
        borderRadiusLG: 12,
      },
      Badge: {
        colorError: PRIMARY,
        indicatorHeight: 20,
        textFontSize: 12,
      },
      Button: {
        fontWeight: 500,
        primaryShadow: '0 6px 18px rgba(124, 92, 255, 0.32)',
        defaultShadow: 'none',
        dangerShadow: 'none',
        defaultBg: scheme.container,
      },
      Card: {
        headerFontSize: 14,
        headerBg: 'transparent',
      },
      Collapse: {
        headerBg: 'transparent',
      },
      Drawer: {
        colorBgElevated: scheme.container,
      },
      Input: {
        activeShadow: '0 0 0 3px rgba(124, 92, 255, 0.18)',
      },
      Menu: {
        itemSelectedBg: scheme.selected,
        itemBorderRadius: 8,
      },
      Modal: {
        borderRadiusLG: 20,
      },
      Notification: {
        borderRadiusLG: 14,
      },
      Segmented: {
        itemSelectedBg: isDarkTheme ? '#262631' : '#FFFFFF',
        trackBg: isDarkTheme ? 'rgba(255, 255, 255, 0.04)' : 'rgba(18, 18, 24, 0.05)',
      },
      Select: {
        optionSelectedBg: scheme.selected,
      },
      Switch: {
        handleSize: 18,
        trackHeight: 22,
        trackMinWidth: 44,
      },
      Table: {
        headerBg: 'transparent',
        headerColor: scheme.textTertiary,
        headerSplitColor: 'transparent',
        rowSelectedBg: scheme.selected,
        rowHoverBg: scheme.hover,
      },
      Tabs: {
        titleFontSize: 13,
        inkBarColor: PRIMARY,
        itemSelectedColor: scheme.text,
        itemColor: scheme.textTertiary,
        itemHoverColor: scheme.text,
      },
      Tag: {
        borderRadiusSM: 6,
      },
      Tooltip: {
        colorBgSpotlight: isDarkTheme ? '#262631' : '#1C1C24',
      },
      Tree: {
        nodeSelectedBg: scheme.selected,
      },
    },
  };
}
