import {IconPlayerPlay, IconTable} from '@tabler/icons-react';
import {Alert, App, Button, Input, Modal, Select, Table, Tag} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {valueText} from '../../../shared/app-data/values.js';
import {readTable, runQuery} from './app-data-store.js';
import {formatSize} from './format.js';
import {ValueCell, ValueDrawer} from './ValueView.jsx';

import styles from './AppData.module.css';

const PAGE = 100;

const cellOf = (value, onOpen) =>
  value && typeof value === 'object' && 'blob' in value ? (
    <Tag>BLOB · {formatSize(value.blob)}</Tag>
  ) : value === null ? (
    <span className={styles.empty}>NULL</span>
  ) : (
    <ValueCell value={value} type={typeof value === 'number' ? 'int' : 'string'} onOpen={onOpen} />
  );

const gridColumns = (names, onOpen) =>
  names.map((name) => ({
    title: name,
    dataIndex: name,
    key: name,
    sorter: true,
    ellipsis: true,
    width: 180,
    render: (value) => cellOf(value, () => onOpen({title: name, value})),
  }));

/**
 * One database: its tables with their row counts, a table by pages with
 * sorting and a filter by column, and SQL. A query that changes data asks
 * first and runs with the app stopped.
 */
const DbView = ({db, table: wanted, marks, version}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const [table, setTable] = useState(wanted ?? db.tables[0]?.name ?? null);
  const [page, setPage] = useState({offset: 0, sort: null, filter: {column: null, text: ''}});
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [sql, setSql] = useState('');
  const [result, setResult] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setTable(wanted ?? db.tables[0]?.name ?? null);
    setPage({offset: 0, sort: null, filter: {column: null, text: ''}});
    setResult(null);
  }, [db.file, wanted, db.tables]);

  useEffect(() => {
    if (!table) {
      setData(null);
      return;
    }
    let live = true;
    setLoading(true);
    readTable(db.file, table, {offset: page.offset, limit: PAGE, sort: page.sort, filter: page.filter})
      .then((next) => live && setData(next))
      .catch(() => live && setData(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // a new read of the data (version) shows the table again
  }, [db.file, table, page, version]);

  const run = async (confirmed = false) => {
    setRunning(true);
    const next = await runQuery(db.file, sql, {confirmed});
    setRunning(false);
    if (next?.kind === 'confirm') {
      setConfirm(true);
      return;
    }
    setConfirm(false);
    setResult(next);
    if (next?.kind === 'changed') {
      message.success(t('dataSqlChanged', {count: next.changes}));
    }
  };

  const meta = db.tables.find((one) => one.name === table);
  const names = data
    ? [...(data.keys[0] === 'rowid' ? ['rowid'] : []), ...data.columns.map((column) => column.name)]
    : [];
  const keyOf = (row) => JSON.stringify((data?.keys ?? []).map((key) => row[key] ?? null));

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.mono}>{db.file}</span>
        <Tag>SQLite</Tag>
        <span className={styles.muted}>{formatSize(db.size)}</span>
      </div>
      {db.error && <p className={styles.errorLine}>{db.error}</p>}
      <div className={styles.tableChips}>
        {db.tables.map((one) => (
          <button
            key={one.name}
            type="button"
            className={`${styles.chip} ${one.name === table ? styles.chipOn : ''}`}
            onClick={() => {
              setTable(one.name);
              setPage({offset: 0, sort: null, filter: {column: null, text: ''}});
            }}
          >
            <IconTable size={13} />
            {one.name}
            <span className={styles.chipCount}>{one.rows}</span>
          </button>
        ))}
        {!db.tables.length && <span className={styles.muted}>{t('dataNoTables')}</span>}
      </div>
      {meta && (
        <>
          <div className={styles.row}>
            <Select
              className={styles.filterColumn}
              placeholder={t('dataFilterColumn')}
              value={page.filter.column}
              allowClear
              onChange={(column) =>
                setPage((was) => ({...was, offset: 0, filter: {...was.filter, column: column ?? null}}))
              }
              options={meta.columns.map((column) => ({value: column.name, label: column.name}))}
            />
            <Input.Search
              className={styles.filterText}
              placeholder={t('dataFilterText')}
              allowClear
              disabled={!page.filter.column}
              onSearch={(text) => setPage((was) => ({...was, offset: 0, filter: {...was.filter, text}}))}
            />
            <span className={styles.muted}>
              {meta.columns
                .map((column) => `${column.name}${column.type ? ` ${column.type}` : ''}${column.pk ? ' PK' : ''}`)
                .join(' · ')}
            </span>
          </div>
          <Table
            size="small"
            loading={loading}
            rowKey={keyOf}
            columns={gridColumns(names, setViewing)}
            dataSource={data?.rows ?? []}
            scroll={{x: 'max-content'}}
            rowClassName={(row) => {
              const mark = marks[`db|${db.file}|${table}|${keyOf(row)}`];
              return mark ? styles[`mark_${mark}`] : '';
            }}
            pagination={{
              current: Math.floor(page.offset / PAGE) + 1,
              pageSize: PAGE,
              total: data?.total ?? 0,
              showSizeChanger: false,
              showTotal: (total) => t('dataRows', {count: total}),
            }}
            onChange={(pagination, _filters, sorter) =>
              setPage((was) => ({
                ...was,
                offset: (pagination.current - 1) * PAGE,
                sort: sorter?.order ? {column: sorter.field, desc: sorter.order === 'descend'} : null,
              }))
            }
          />
        </>
      )}

      <div className={styles.sql}>
        <Input.TextArea
          className={styles.mono}
          value={sql}
          onChange={(event) => setSql(event.target.value)}
          placeholder={table ? `SELECT * FROM "${table}" LIMIT 20` : 'SELECT …'}
          autoSize={{minRows: 2, maxRows: 8}}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              run();
            }
          }}
        />
        <div className={styles.row}>
          <Button
            type="primary"
            icon={<IconPlayerPlay size={14} />}
            loading={running}
            disabled={!sql.trim()}
            onClick={() => run()}
          >
            {t('dataSqlRun')}
          </Button>
          <span className={styles.hint}>{t('dataSqlHint')}</span>
        </div>
        {result?.kind === 'error' && (
          <Alert type="error" showIcon title={t('dataSqlError')} description={result.message} />
        )}
        {result?.kind === 'rows' && (
          <Table
            size="small"
            rowKey={(_row, index) => index}
            columns={gridColumns(result.columns, setViewing).map((column) => ({
              ...column,
              sorter: (a, b) => valueText(a[column.dataIndex]).localeCompare(valueText(b[column.dataIndex])),
            }))}
            dataSource={result.rows}
            scroll={{x: 'max-content'}}
            pagination={{pageSize: 50, showSizeChanger: false}}
            footer={result.truncated ? () => t('dataSqlTruncated') : undefined}
          />
        )}
      </div>

      <Modal
        open={confirm}
        title={t('dataSqlConfirmTitle')}
        onCancel={() => setConfirm(false)}
        onOk={() => run(true)}
        okText={t('dataSqlConfirmOk')}
        okButtonProps={{danger: true}}
        cancelText={t('dataCancel')}
        confirmLoading={running}
      >
        <p>{t('dataSqlConfirmText')}</p>
        <pre className={styles.pre}>{sql}</pre>
      </Modal>
      <ValueDrawer open={!!viewing} onClose={() => setViewing(null)} {...(viewing ?? {})} />
    </div>
  );
};

export default DbView;
