import {AnimatePresence, motion} from 'motion/react';
import {useMemo} from 'react';

import {visibleIssues} from '../../A11yTab/a11y-ui.js';

import styles from './Overlays.module.css';

/**
 * Accessibility issues drawn on the screenshot: a box per issue in its
 * severity colour, linked with the list (hover one, the other lights up),
 * and optionally the order a screen reader goes through the screen.
 */
const A11yOverlay = (props) => {
  const {a11yScan, a11yOverlay, a11yHighlight, setA11yHighlight, scaleRatio} = props;
  const {visible} = useMemo(() => visibleIssues(props), [props]);

  if (!a11yScan?.scale || !scaleRatio) {
    return null;
  }
  // screenshot pixels -> device units -> CSS pixels of the shown image
  const toCss = (rect) => ({
    left: rect.x / a11yScan.scale / scaleRatio,
    top: rect.y / a11yScan.scale / scaleRatio,
    width: rect.width / a11yScan.scale / scaleRatio,
    height: rect.height / a11yScan.scale / scaleRatio,
  });

  return (
    <div className={styles.a11yLayer}>
      <AnimatePresence>
        {a11yOverlay.issues &&
          visible.map((violation, index) => (
            <motion.div
              key={violation.id}
              className={`${styles.a11yBox} ${styles[`a11y_${violation.severity}`]} ${
                a11yHighlight === violation.id ? styles.a11yBoxActive : ''
              }`}
              style={toCss(violation.bounds)}
              initial={{opacity: 0, scale: 1.15}}
              animate={{opacity: 1, scale: 1}}
              exit={{opacity: 0, scale: 0.9}}
              transition={{duration: 0.35, delay: Math.min(index, 20) * 0.02, ease: [0.22, 1, 0.36, 1]}}
              onMouseEnter={() => setA11yHighlight(violation.id)}
              onMouseLeave={() => setA11yHighlight(null)}
              onClick={(e) => {
                e.stopPropagation();
                setA11yHighlight(violation.id);
              }}
            />
          ))}
        {a11yOverlay.readingOrder &&
          a11yScan.readingOrder.map((stop, index) => {
            const box = toCss(stop.bounds);
            return (
              <motion.div
                key={`order-${stop.nodeKey}`}
                className={styles.a11yOrderBadge}
                style={{left: box.left + 2, top: box.top + 2}}
                initial={{opacity: 0, scale: 0.4}}
                animate={{opacity: 1, scale: 1}}
                exit={{opacity: 0, scale: 0.4}}
                transition={{type: 'spring', stiffness: 500, damping: 28, delay: Math.min(index, 40) * 0.025}}
              >
                {index + 1}
              </motion.div>
            );
          })}
      </AnimatePresence>
    </div>
  );
};

export default A11yOverlay;
