import {IconDownload, IconFile, IconFolder, IconStar, IconStarFilled, IconTrash} from '@tabler/icons-react';
import {Alert, App, Button, Empty, Popconfirm, Spin, Tree} from 'antd';
import {useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {pathForFile, putFile, readFileContent, removeFile, saveToMac} from './app-data-store.js';
import {formatSize} from './format.js';

import styles from './AppData.module.css';

/** The sandbox as a tree of folders and files, each folder with the size of what is in it. */
export function fileTree(files) {
  const root = {children: new Map(), size: 0};
  for (const file of files) {
    let node = root;
    root.size += file.size;
    const parts = file.path.split('/');
    parts.forEach((part, index) => {
      const key = parts.slice(0, index + 1).join('/');
      if (!node.children.has(part)) {
        node.children.set(part, {key, name: part, children: new Map(), size: 0, file: null});
      }
      node = node.children.get(part);
      node.size += file.size;
    });
    node.file = file;
  }
  const toData = (node) =>
    [...node.children.values()]
      .sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name))
      .map((child) => ({
        key: child.key,
        name: child.name,
        size: child.size,
        file: child.file,
        isLeaf: !!child.file,
        children: child.file ? undefined : toData(child),
      }));
  return toData(root);
}

const parentOf = (file) => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');

/**
 * Every file of the sandbox. A file opens as text, a picture or hex; a file
 * or folder can be saved to this Mac; a file from Finder dropped on a folder
 * goes into it, dropped on a file takes its place.
 */
const FilesView = ({files, marks, selected, onSelect, version, canDelete, pinned, onTogglePin}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dropOn, setDropOn] = useState(null);
  const tree = useMemo(() => fileTree(files), [files]);
  const selectedFile = files.find((file) => file.path === selected);

  useEffect(() => {
    if (!selectedFile) {
      setContent(null);
      return;
    }
    let live = true;
    setLoading(true);
    readFileContent(selectedFile.path)
      .then((next) => live && setContent(next))
      .catch((error) => live && setContent({error: String(error?.message ?? error)}))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // a new read of the data (version) shows the file again
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile?.path, selectedFile?.size, selectedFile?.mtime, version]);

  const drop = async (event, node) => {
    event.preventDefault();
    event.stopPropagation();
    setDropOn(null);
    const dropped = event.dataTransfer?.files?.[0];
    if (!dropped) {
      return;
    }
    const local = pathForFile(dropped);
    const target = node.isLeaf ? node.key : `${node.key}/${dropped.name}`;
    const result = await putFile(target, local);
    if (result?.ok) {
      message.success(t('dataPutDone', {path: target}));
      onSelect(target);
    } else {
      message.error(result?.error ?? t('dataFailed'));
    }
  };

  const save = async (path, isFolder) => {
    const result = await saveToMac(path, isFolder);
    if (result?.ok) {
      message.success(t('dataSaveDone', {count: result.files}));
    } else if (!result?.canceled) {
      message.error(result?.error ?? t('dataFailed'));
    }
  };

  const remove = async (path) => {
    const result = await removeFile(path);
    if (result?.ok) {
      message.success(t('dataRemoved', {key: path}));
      onSelect(parentOf(path) || null);
    } else {
      message.error(
        result?.code === 'notSupported' ? t('dataNotSupported_remove') : (result?.error ?? t('dataFailed')),
      );
    }
  };

  const title = (node) => {
    const mark = marks[`files|${node.key}`];
    return (
      <span
        className={`${styles.treeNode} ${dropOn === node.key ? styles.treeDrop : ''} ${mark ? styles[`markText_${mark}`] : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDropOn(node.key);
        }}
        onDragLeave={() => setDropOn((was) => (was === node.key ? null : was))}
        onDrop={(event) => drop(event, node)}
      >
        {node.isLeaf ? (
          <IconFile size={14} className={styles.treeIcon} />
        ) : (
          <IconFolder size={14} className={styles.treeIcon} />
        )}
        <span className={styles.treeName}>{node.name}</span>
        <span className={styles.treeSize}>{formatSize(node.size)}</span>
      </span>
    );
  };

  const isFolder = selected && !selectedFile && files.some((file) => file.path.startsWith(`${selected}/`));

  return (
    <div className={styles.filesView}>
      <div className={styles.filesTree}>
        <Tree
          treeData={tree}
          titleRender={title}
          fieldNames={{title: 'name', key: 'key', children: 'children'}}
          selectedKeys={selected ? [selected] : []}
          onSelect={(keys) => onSelect(keys[0] ?? null)}
          blockNode
          height={600}
        />
        <p className={styles.hint}>{t('dataDropHint')}</p>
      </div>
      <div className={styles.filesPreview}>
        {!selected && <Empty description={t('dataPickFile')} />}
        {isFolder && (
          <div className={styles.previewHead}>
            <IconFolder size={16} />
            <span className={styles.mono}>{selected}</span>
            <div className={styles.spacer} />
            <Button size="small" icon={<IconDownload size={14} />} onClick={() => save(selected, true)}>
              {t('dataSaveFolder')}
            </Button>
          </div>
        )}
        {selectedFile && (
          <>
            <div className={styles.previewHead}>
              <IconFile size={16} />
              <span className={styles.mono}>{selectedFile.path}</span>
              <span className={styles.muted}>{formatSize(selectedFile.size)}</span>
              <div className={styles.spacer} />
              <Button
                size="small"
                icon={pinned.has(selectedFile.path) ? <IconStarFilled size={14} /> : <IconStar size={14} />}
                onClick={() => onTogglePin(selectedFile.path)}
              >
                {pinned.has(selectedFile.path) ? t('dataUnpin') : t('dataPin')}
              </Button>
              <Button size="small" icon={<IconDownload size={14} />} onClick={() => save(selectedFile.path, false)}>
                {t('dataSaveFile')}
              </Button>
              {canDelete && (
                <Popconfirm
                  title={t('dataRemoveConfirm', {key: selectedFile.path})}
                  okText={t('dataRemove')}
                  cancelText={t('dataCancel')}
                  onConfirm={() => remove(selectedFile.path)}
                >
                  <Button size="small" danger icon={<IconTrash size={14} />}>
                    {t('dataRemove')}
                  </Button>
                </Popconfirm>
              )}
            </div>
            {loading && <Spin />}
            {content?.error && <Alert type="error" showIcon title={t('dataReadFailed')} description={content.error} />}
            {content?.image && <img className={styles.previewImage} src={content.image} alt={selectedFile.path} />}
            {content?.text !== undefined && <pre className={styles.preview}>{content.text}</pre>}
            {content?.truncated && <p className={styles.hint}>{t('dataTruncated')}</p>}
            {content?.hex && <pre className={styles.preview}>{content.hex}</pre>}
          </>
        )}
      </div>
    </div>
  );
};

export default FilesView;
