import {App} from 'antd';
import {useCallback} from 'react';
import {useTranslation} from 'react-i18next';

/**
 * What a start of a session asks and says about a session already live on
 * the device: `decide` asks whether to join one of another app or start
 * anew, `joined` says that the Inspector joined one.
 */
export function useJoinSession() {
  const {t} = useTranslation();
  const {modal, message} = App.useApp();

  const decide = useCallback(
    (session) =>
      new Promise((resolve) => {
        modal.confirm({
          title: t('quickLiveSessionAsk'),
          content: t('quickLiveSessionHint', {app: session.app ?? t('quickNoApp')}),
          okText: t('quickLiveSessionJoin'),
          cancelText: t('quickLiveSessionNew'),
          // one of the two: a new session ends the other one on our server
          keyboard: false,
          maskClosable: false,
          onOk: () => resolve('attach'),
          onCancel: () => resolve('new'),
        });
      }),
    [modal, t],
  );

  const joined = useCallback(
    (result) => {
      if (result?.attached) {
        message.info(t('quickLiveSessionJoined'));
      }
    },
    [message, t],
  );

  return {decide, joined};
}
