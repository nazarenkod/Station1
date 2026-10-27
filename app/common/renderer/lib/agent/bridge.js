import {compileMasks} from '../../../shared/agent/privacy.js';
import {compactFlow, compactTree} from '../../../shared/agent/screen.js';
import {AI_CONFIG} from '../../../shared/setting-defs.js';
import {activeDevice} from '../../actions/Workstation.js';
import {screenHistory} from '../../components/A11yTool/screen-history.js';
import {backend, getSetting} from '../../polyfills.js';
import {parseUiTree} from '../a11y/ui-tree.ts';
import {profilesState} from '../settings/profiles-store.js';
import {currentPicks} from './selection.js';

// The main process asks the window what only the window knows: the open tab,
// the device and app, the screen on the device and the flow of the session.
// Each answer is short; the main process puts it through the read budget.

const MAX_SCREENSHOT_SIDE = 720;

let started = false;

const currentScreen = () => {
  const flow = screenHistory();
  const screen = flow.screens?.find((one) => one.key === flow.currentKey);
  const state = screen?.states?.find((one) => one.id === flow.currentStateId);
  return screen ? {title: screen.title ?? null, state: state?.title ?? (state ? `state ${state.number}` : null)} : null;
};

async function shrink(screenshot) {
  const image = new Image();
  image.src = `data:image/png;base64,${screenshot}`;
  await image.decode();
  const scale = Math.min(1, MAX_SCREENSHOT_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.7);
}

function answers(store) {
  return {
    async state() {
      const {workstation, inspector} = store.getState();
      const device = activeDevice(workstation);
      const profiles = profilesState();
      return {
        profile: profiles.list.find((one) => one.id === profiles.activeId)?.name ?? null,
        tab: currentPicks().tab?.id ?? null,
        device: device ? {name: device.name, platform: device.platformName, os: device.platformVersion ?? null} : null,
        app: workstation.app?.id ?? null,
        appium: inspector?.driver ? 'session' : (workstation.appium?.status ?? 'stopped'),
        screen: currentScreen(),
      };
    },
    async screen({screenshot}) {
      const {inspector} = store.getState();
      if (!inspector?.sourceXML) {
        return {error: 'No screen yet: the Inspector has no session with the device.'};
      }
      const masks = compileMasks((await getSetting(AI_CONFIG))?.maskPatterns ?? undefined);
      const tree = compactTree(parseUiTree(inspector.sourceXML, {}), {masks});
      return {
        screen: currentScreen(),
        elements: `${tree.shown} of ${tree.total}`,
        tree: tree.lines.join('\n'),
        // the picture of the screen is not masked; it goes only when asked
        screenshot: screenshot && inspector.screenshot ? await shrink(inspector.screenshot) : undefined,
      };
    },
    async flow() {
      return compactFlow(screenHistory());
    },
    async a11yFindings() {
      const scan = store.getState().inspector?.a11yScan;
      return (scan?.violations ?? []).map((violation) => ({
        id: violation.id,
        tool: 'a11y',
        rule: violation.rule,
        severity: violation.severity === 'error' ? 'high' : violation.severity === 'warning' ? 'medium' : 'low',
        subject: `${violation.title}: ${violation.label || violation.resourceId || violation.className}`,
      }));
    },
  };
}

/** Starts answering the main process. Called once by the shell. */
export function startAgentBridge(store) {
  if (started || !backend?.agent) {
    return;
  }
  started = true;
  const handlers = answers(store);
  backend.agent.onAsk(async ({id, kind, args}) => {
    let result;
    try {
      result = handlers[kind] ? await handlers[kind](args ?? {}) : {error: `Unknown: ${kind}`};
    } catch (error) {
      result = {error: error.message};
    }
    await backend.agent.answer(id, result);
  });
}
