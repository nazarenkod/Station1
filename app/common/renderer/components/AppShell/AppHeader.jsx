import {motion} from 'motion/react';

import logo from '../../assets/images/vision-logo.svg';

import styles from './AppShell.module.css';

/**
 * The bar at the top of every page: the Vision Inspector mark, what the page
 * is about, and its actions. On macOS it doubles as the window's title bar.
 */
const AppHeader = ({subtitle, children, actions}) => (
  <header className={styles.appHeader}>
    <motion.div
      className={styles.brand}
      initial={{opacity: 0, x: -8}}
      animate={{opacity: 1, x: 0}}
      transition={{duration: 0.45, ease: [0.22, 1, 0.36, 1]}}
    >
      <motion.img
        src={logo}
        alt=""
        className={styles.brandMark}
        whileHover={{rotate: -8, scale: 1.06}}
        transition={{type: 'spring', stiffness: 400, damping: 18}}
      />
      <span className={styles.wordmark}>
        <span className="vi-gradient-text">Vision</span> Inspector
      </span>
      {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
    </motion.div>
    <div className={styles.headerCenter}>{children}</div>
    {actions && <div className={styles.headerActions}>{actions}</div>}
  </header>
);

export default AppHeader;
