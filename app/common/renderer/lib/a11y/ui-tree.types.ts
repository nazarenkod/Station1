// Ported from vision (backend/src/ui-tree): keep in sync until both use a shared package.

export type UiTreeFormat = 'appium-android' | 'appium-ios';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One element of an Appium page source, normalized across Android
 * (UiAutomator2) and iOS (XCUITest). Bounds are in screenshot pixels, so they
 * can be drawn over the image and compared with diff regions directly.
 */
export interface UiNode {
  index: number;
  parent: number | null;
  depth: number;
  // stable identity used to match the same element between baseline and current
  key: string;
  // class name on Android, element type on iOS (e.g. android.widget.Button, XCUIElementTypeButton)
  className: string;
  resourceId: string;
  text: string;
  // content-desc on Android, label on iOS
  label: string;
  // hint on Android, placeholderValue on iOS
  hint: string;
  clickable: boolean;
  focusable: boolean;
  enabled: boolean;
  visible: boolean;
  // false only when the platform says so explicitly (iOS accessible="false")
  accessible: boolean;
  // absent on trees stored before these were read
  checked?: boolean;
  selected?: boolean;
  // Android: the view reports a checked state (switches, checkboxes)
  checkable?: boolean;
  // Android password fields; iOS SecureTextField
  password?: boolean;
  bounds: Rect;
  // Vision Inspector: the element's path in the inspector's source tree ("0.1.3")
  elementPath?: string;
}

export interface UiTree {
  format: UiTreeFormat;
  // screenshot pixels per tree unit: 1 on Android, 2–3 on iOS (points → pixels)
  scale: number;
  // screen width/height in screenshot pixels
  width: number;
  height: number;
  // screenshot pixels per dp (Android) or pt (iOS)
  pixelsPerDp: number;
  pixelsPerDpEstimated: boolean;
  // Android activity the screen belongs to, when the client sent it
  activity?: string;
  nodes: UiNode[];
}
