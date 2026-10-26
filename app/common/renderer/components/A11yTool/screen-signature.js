// the screenshot is compared at this size, in shades of grey
const SIGNATURE_WIDTH = 18;
const SIGNATURE_HEIGHT = 36;
// the status bar (clock, battery) changes on its own: left out of the comparison
const STATUS_BAR_FRACTION = 0.08;
// the average difference of brightness, 0 to 1, from which the screen is another one
export const CHANGED = 0.025;

/**
 * A tiny greyscale picture of the screenshot, enough to tell another screen
 * from the same one with a blinking cursor or a ticking clock.
 */
export async function screenSignature(screenshot) {
  const blob = await (await fetch(`data:image/png;base64,${screenshot}`)).blob();
  const image = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = SIGNATURE_WIDTH;
  canvas.height = SIGNATURE_HEIGHT;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  const top = image.height * STATUS_BAR_FRACTION;
  context.drawImage(image, 0, top, image.width, image.height - top, 0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
  image.close();
  const {data} = context.getImageData(0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
  const grey = new Float32Array(SIGNATURE_WIDTH * SIGNATURE_HEIGHT);
  for (let i = 0; i < grey.length; i++) {
    grey[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
  }
  return grey;
}

export function signatureDistance(a, b) {
  if (!a || !b || a.length !== b.length) {
    return 1;
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum / a.length;
}
