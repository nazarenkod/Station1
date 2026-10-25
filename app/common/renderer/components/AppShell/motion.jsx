import {motion} from 'motion/react';

export const EASE_OUT = [0.22, 1, 0.36, 1];

// children of a Stagger container rise into place one after another
const staggerContainer = {
  hidden: {},
  shown: {transition: {staggerChildren: 0.06, delayChildren: 0.04}},
};

const staggerItem = {
  hidden: {opacity: 0, y: 14, scale: 0.985},
  shown: {opacity: 1, y: 0, scale: 1, transition: {duration: 0.5, ease: EASE_OUT}},
};

export const Stagger = ({children, className, style}) => (
  <motion.div className={className} style={style} variants={staggerContainer} initial="hidden" animate="shown">
    {children}
  </motion.div>
);

export const StaggerItem = ({children, className, style}) => (
  <motion.div className={className} style={style} variants={staggerItem}>
    {children}
  </motion.div>
);

/**
 * A whole page sliding in, used for route changes.
 */
export const PageTransition = ({children, className}) => (
  <motion.div
    className={className}
    initial={{opacity: 0, y: 10, filter: 'blur(4px)'}}
    animate={{opacity: 1, y: 0, filter: 'blur(0px)'}}
    exit={{opacity: 0, y: -8, filter: 'blur(4px)'}}
    transition={{duration: 0.4, ease: EASE_OUT}}
    style={{height: '100%'}}
  >
    {children}
  </motion.div>
);

/**
 * Content that fades in whenever its key changes (tab panels, filtered lists).
 */
export const FadeSwap = ({children, className, style}) => (
  <motion.div
    className={className}
    style={style}
    initial={{opacity: 0, y: 6}}
    animate={{opacity: 1, y: 0}}
    transition={{duration: 0.3, ease: EASE_OUT}}
  >
    {children}
  </motion.div>
);
