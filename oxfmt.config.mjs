import appiumConfig, {defineConfig, ignorePatterns} from '@appium/oxc-config/oxfmt';

export default defineConfig({
  ...appiumConfig,
  ignorePatterns: [...ignorePatterns, 'dist-cli/**', 'plugins/dist-node/**', '**/*.log', '**/*.xml', '!app/**/*.html'],
  overrides: [
    {
      files: ['docs/*.md'],
      options: {
        tabWidth: 4,
      },
    },
  ],
});
