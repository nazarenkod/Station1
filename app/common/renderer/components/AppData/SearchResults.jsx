import {IconDatabase, IconFile, IconFileText, IconSettings} from '@tabler/icons-react';
import {Empty, Spin} from 'antd';
import {useTranslation} from 'react-i18next';

import styles from './AppData.module.css';

const Highlight = ({text, range}) =>
  range ? (
    <>
      {text.slice(0, range[0])}
      <mark className={styles.hit}>{text.slice(range[0], range[1])}</mark>
      {text.slice(range[1])}
    </>
  ) : (
    text
  );

const Group = ({icon: Icon, title, items, render}) =>
  items.length ? (
    <section className={styles.searchGroup}>
      <h3>
        <Icon size={14} /> {title} <span className={styles.count}>{items.length}</span>
      </h3>
      <ul>{items.map(render)}</ul>
    </section>
  ) : null;

/** What one search found, by section; a click goes to the place. */
const SearchResults = ({search, onOpen}) => {
  const {t} = useTranslation();
  const found = search.result;
  if (!found) {
    return search.busy ? <Spin className={styles.center} /> : null;
  }
  if (!found.total) {
    return <Empty className={styles.center} description={t('dataSearchNothing', {query: found.query})} />;
  }
  return (
    <div className={styles.search}>
      {search.busy && <Spin size="small" />}
      <Group
        icon={IconSettings}
        title={t('dataSection_prefs')}
        items={found.prefs}
        render={(one) => (
          <li key={`${one.file}|${one.key}`}>
            <button type="button" onClick={() => onOpen({section: 'prefs', file: one.file, key: one.key})}>
              <span className={styles.mono}>
                <Highlight text={one.key} range={one.keyRange} />
              </span>
              <span className={styles.searchValue}>
                <Highlight {...one.value} />
              </span>
              <span className={styles.searchWhere}>{one.file}</span>
            </button>
          </li>
        )}
      />
      <Group
        icon={IconDatabase}
        title={t('dataSection_dbs')}
        items={found.rows}
        render={(one) => (
          <li key={`${one.file}|${one.table}|${one.key}|${one.column}`}>
            <button type="button" onClick={() => onOpen({section: 'dbs', file: one.file, table: one.table})}>
              <span className={styles.mono}>
                {one.table}.{one.column}
              </span>
              <span className={styles.searchValue}>
                <Highlight {...one.value} />
              </span>
              <span className={styles.searchWhere}>
                {one.file} · {one.key}
              </span>
            </button>
          </li>
        )}
      />
      <Group
        icon={IconFile}
        title={t('dataSearchFileNames')}
        items={found.files}
        render={(one) => (
          <li key={one.path}>
            <button type="button" onClick={() => onOpen({section: 'files', file: one.path})}>
              <span className={styles.mono}>
                <Highlight text={one.path} range={one.range} />
              </span>
            </button>
          </li>
        )}
      />
      <Group
        icon={IconFileText}
        title={t('dataSearchTexts')}
        items={found.texts}
        render={(one) => (
          <li key={`${one.path}|${one.line}`}>
            <button type="button" onClick={() => onOpen({section: 'files', file: one.path})}>
              <span className={styles.searchValue}>
                <Highlight text={one.text} range={one.range} />
              </span>
              <span className={styles.searchWhere}>
                {one.path}:{one.line}
              </span>
            </button>
          </li>
        )}
      />
    </div>
  );
};

export default SearchResults;
