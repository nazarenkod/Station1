import {IconPlayerPause, IconPlayerPlay, IconRefresh, IconSearch} from '@tabler/icons-react';
import {Button, Space, Tooltip} from 'antd';
import {useTranslation} from 'react-i18next';

import LocatorSearchModal from './LocatorSearch/LocatorSearchModal.jsx';

/**
 * Button for toggling automatic source/screenshot refresh.
 */
const ToggleAutomaticRefreshButton = ({isSourceRefreshOn, setRefreshingState}) => {
  const {t} = useTranslation();
  const pauseRefreshLabel = t('Pause Refreshing Source');
  const startRefreshLabel = t('Start Refreshing Source');

  return isSourceRefreshOn ? (
    <Tooltip title={pauseRefreshLabel}>
      <Button
        aria-label={pauseRefreshLabel}
        id="btnPauseRefreshing"
        icon={<IconPlayerPause size={18} />}
        onClick={() => setRefreshingState({source: false})}
      />
    </Tooltip>
  ) : (
    <Tooltip title={startRefreshLabel}>
      <Button
        aria-label={startRefreshLabel}
        id="btnStartRefreshing"
        icon={<IconPlayerPlay size={18} />}
        onClick={() => setRefreshingState({source: true})}
      />
    </Tooltip>
  );
};

/**
 * Button for explicitly refreshing the app source/screenshot.
 */
const ManualRefreshButton = ({applyClientMethod}) => {
  const {t} = useTranslation();
  const refreshLabel = t('refreshSource');

  return (
    <Tooltip title={refreshLabel}>
      <Button
        aria-label={refreshLabel}
        id="btnReload"
        icon={<IconRefresh size={18} />}
        onClick={() => applyClientMethod({methodName: 'getPageSource'})}
      />
    </Tooltip>
  );
};

/**
 * Button to open the locator search modal.
 */
const SearchForElementButton = (props) => {
  const {showLocatorSearchModal} = props;
  const {t} = useTranslation();
  const searchLabel = t('Search for element');

  return (
    <>
      <Tooltip title={searchLabel}>
        <Button
          aria-label={searchLabel}
          id="searchForElement"
          icon={<IconSearch size={18} />}
          onClick={showLocatorSearchModal}
        />
      </Tooltip>
      <LocatorSearchModal {...props} />
    </>
  );
};

/**
 * Controls for general session actions. The upstream recorder is left out:
 * the station records the session itself (screens, traffic, log).
 */
const GeneralControlsGroup = (props) => {
  const {isUsingMjpegMode, isSourceRefreshOn, setRefreshingState, applyClientMethod} = props;
  return (
    <Space.Compact>
      {isUsingMjpegMode && (
        <ToggleAutomaticRefreshButton
          isUsingMjpegMode={isUsingMjpegMode}
          isSourceRefreshOn={isSourceRefreshOn}
          setRefreshingState={setRefreshingState}
        />
      )}
      <ManualRefreshButton applyClientMethod={applyClientMethod} />
      <SearchForElementButton {...props} />
    </Space.Compact>
  );
};

export default GeneralControlsGroup;
