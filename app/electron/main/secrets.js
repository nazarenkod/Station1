import {safeStorage} from 'electron';
import settings from 'electron-settings';

/**
 * A secret (an API token or key) kept in the settings file, encrypted by the
 * OS keychain. It never reaches the renderer: only whether it is set.
 */
export function encryptedSecret(settingKey, what = 'token') {
  const read = async () => {
    const stored = await settings.get(settingKey);
    if (!stored) {
      return null;
    }
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch {
      return null;
    }
  };

  const write = async (value) => {
    if (!value) {
      await settings.unset(settingKey);
      return true;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(`The system keychain is not available to keep the ${what} safe`);
    }
    await settings.set(settingKey, safeStorage.encryptString(value).toString('base64'));
    return true;
  };

  return {read, write, has: async () => !!(await read())};
}
