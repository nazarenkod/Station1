import {motion} from 'motion/react';

import {EASE_OUT} from '../AppShell/motion.jsx';

import styles from './Workstation.module.css';

/**
 * What a tool shows while it has nothing to work with: its icon in the tool's
 * colour, what is missing, how to get there, and one way forward.
 *
 * `steps` is an optional list of short sentences, shown numbered under the text.
 */
const EmptyState = ({tool = 'home', icon: Icon, title, text, steps, actions, children}) => (
  <div className={`${styles.placeholder} ${styles[`tool_${tool}`]}`}>
    <motion.div
      className={styles.placeholderCard}
      initial={{opacity: 0, y: 12}}
      animate={{opacity: 1, y: 0}}
      transition={{duration: 0.45, ease: EASE_OUT}}
    >
      {Icon && (
        <div className={styles.placeholderIcon} aria-hidden="true">
          <Icon size={30} stroke={1.5} />
        </div>
      )}
      <h1 className={styles.placeholderTitle}>{title}</h1>
      {text && <p className={styles.placeholderText}>{text}</p>}
      {steps?.length > 0 && (
        <ol className={styles.placeholderSteps}>
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
      {actions && <div className={styles.placeholderActions}>{actions}</div>}
      {children}
    </motion.div>
  </div>
);

export default EmptyState;
