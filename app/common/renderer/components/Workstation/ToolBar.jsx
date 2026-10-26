import styles from './Workstation.module.css';

/**
 * A tool's own controls, under the tool tabs: an optional title on the left,
 * the main controls in the middle, actions on the right.
 */
const ToolBar = ({title, children, actions}) => (
  <div className={styles.toolBar}>
    {title && <div className={styles.toolTitle}>{title}</div>}
    <div className={styles.toolCenter}>{children}</div>
    {actions && <div className={styles.toolActions}>{actions}</div>}
  </div>
);

export default ToolBar;
