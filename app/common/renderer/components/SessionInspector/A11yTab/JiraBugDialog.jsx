import {IconBug, IconChevronDown, IconExternalLink, IconSettings} from '@tabler/icons-react';
import {Alert, AutoComplete, Button, Form, Input, Modal, Progress, Select, Space} from 'antd';
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {JIRA_MEMORY} from '../../../../shared/setting-defs.js';
import {backend, getSetting, openLink, setSetting} from '../../../polyfills.js';
import {notification} from '../../../utils/notification.js';
import JiraFieldInput from '../../Jira/JiraFieldInput.jsx';
import JiraSettingsModal, {loadJiraSettings} from '../../Jira/JiraSettingsModal.jsx';

import styles from './JiraBugDialog.module.css';

const JIRA_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
// vision's outline: magenta, 6 px, 6 px away from the element
const OUTLINE = {color: 'rgb(255, 0, 128)', width: 6, padding: 6};

/**
 * The screenshot with the element outlined, as base64 PNG for the attachment
 * and as a data URL for the preview.
 */
async function outlineScreenshot(base64Png, bounds) {
  const image = new Image();
  image.src = `data:image/png;base64,${base64Png}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  context.strokeStyle = OUTLINE.color;
  context.lineWidth = OUTLINE.width;
  const inset = OUTLINE.width / 2;
  context.strokeRect(
    bounds.x - OUTLINE.padding + inset,
    bounds.y - OUTLINE.padding + inset,
    bounds.width + 2 * OUTLINE.padding - OUTLINE.width,
    bounds.height + 2 * OUTLINE.padding - OUTLINE.width,
  );
  const dataUrl = canvas.toDataURL('image/png');
  return {dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1)};
}

const locatorOf = (violation, isIos) => {
  if (violation.resourceId) {
    return isIos ? `accessibility id: ${violation.resourceId}` : `id: ${violation.resourceId}`;
  }
  if (violation.label) {
    return isIos ? `accessibility id: ${violation.label}` : `content-desc / text: ${violation.label}`;
  }
  return `class: ${violation.className}`;
};

const deviceOf = (caps) =>
  [
    caps['appium:deviceName'] ?? caps.deviceName,
    [caps.platformName, caps['appium:platformVersion'] ?? caps.platformVersion].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(' · ');

const mostUsed = (usage = {}, options) =>
  options.filter((option) => usage[option]).sort((a, b) => usage[b] - usage[a])[0] ?? null;

/**
 * Files a Jira bug for one accessibility issue, the way vision does: under a
 * task, with the team's template; the task and choices are remembered per screen.
 */
const JiraBugDialog = ({
  violation,
  onClose,
  a11yScreen,
  a11yDevice,
  a11yScan,
  screenshot,
  sessionCaps,
  recordA11yDecision,
}) => {
  const {t} = useTranslation();
  const [settings, setSettings] = useState(null);
  const [hasToken, setHasToken] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memory, setMemory] = useState({});
  const [block, setBlock] = useState('');
  const [parentKey, setParentKey] = useState('');
  const [prep, setPrep] = useState(null);
  const [issueTypeId, setIssueTypeId] = useState();
  const [linkType, setLinkType] = useState();
  const [chosen, setChosen] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filing, setFiling] = useState(false);
  const [preview, setPreview] = useState(null);
  const [showDescription, setShowDescription] = useState(false);
  const preparedFor = useRef('');

  const open = !!violation;
  const screenKey = `${a11yDevice?.appId}::${a11yScreen?.key}`;
  const isIos = a11yScan?.format === 'appium-ios';

  // settings, remembered choices and the outlined screenshot, each time the dialog opens
  useEffect(() => {
    if (!open || !backend.available) {
      return;
    }
    let cancelled = false;
    (async () => {
      const [loaded, token, remembered] = await Promise.all([
        loadJiraSettings(),
        backend.jira.hasToken(),
        getSetting(JIRA_MEMORY),
      ]);
      if (cancelled) {
        return;
      }
      const mem = remembered ?? {};
      setSettings(loaded);
      setHasToken(token);
      setMemory(mem);
      setBlock(mem.blockByScreen?.[screenKey] ?? mem.lastBlock ?? loaded.blocks[0] ?? '');
      setParentKey(mem.parentByScreen?.[screenKey] ?? mem.lastParent ?? '');
      setChosen(mem.fields ?? {});
      setIssueTypeId(undefined);
      setPrep(null);
      setError(null);
      preparedFor.current = '';
      if (screenshot) {
        setPreview(await outlineScreenshot(screenshot, violation.bounds));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, violation, screenKey, screenshot, settingsOpen]);

  const configured = !!(settings?.url && settings?.email && hasToken);
  const keyValid = JIRA_KEY.test(parentKey.trim());

  const request = useMemo(
    () =>
      violation && {
        violation: {...violation, issue: undefined},
        block: block.trim(),
        screen: a11yScreen?.title ?? null,
        device: deviceOf(sessionCaps ?? {}),
        app: a11yDevice?.appId ?? '',
        locator: locatorOf(violation, isIos),
        suggestedLabel: violation.details?.suggestedLabel ?? null,
        parentKey: parentKey.trim().toUpperCase(),
      },
    [violation, block, a11yScreen, sessionCaps, a11yDevice, isIos, parentKey],
  );

  const inputs = prep?.inputs ?? [];
  const valueOf = (input) => chosen[input.id]?.value ?? input.value;
  const fieldValues = Object.fromEntries(
    inputs
      .filter((input) => valueOf(input) !== undefined && valueOf(input) !== null)
      .map((input) => [input.id, valueOf(input)]),
  );

  // Jira is asked once the key looks complete, and again when the type changes
  useEffect(() => {
    if (!open || !configured || !keyValid || !block.trim()) {
      setPrep(null);
      preparedFor.current = '';
      return;
    }
    const signature = `${request.parentKey}|${issueTypeId ?? ''}|${block}`;
    if (preparedFor.current === signature) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      const result = await backend.jira.prepare({...request, issueTypeId, fieldValues});
      if (cancelled) {
        return;
      }
      setLoading(false);
      if (!result.ok) {
        setPrep(null);
        preparedFor.current = '';
        setError(result.error);
        return;
      }
      let wanted = result.issueTypes.some((type) => type.id === issueTypeId) ? issueTypeId : undefined;
      if (!wanted) {
        const preferred = mostUsed(
          memory.issueTypes,
          result.issueTypes.map((type) => type.id),
        );
        if (preferred && preferred !== result.issueTypeId) {
          // the type used most often wins; its fields come with the next answer
          setIssueTypeId(preferred);
          return;
        }
        wanted = result.issueTypeId;
      }
      preparedFor.current = `${request.parentKey}|${wanted}|${block}`;
      setIssueTypeId(wanted);
      setLinkType(
        (current) =>
          (current && result.linkTypes.includes(current) ? current : undefined) ??
          mostUsed(memory.linkTypes, result.linkTypes) ??
          result.linkType ??
          undefined,
      );
      setPrep(result);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // fieldValues are sent along but do not trigger a new request
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open, configured, keyValid, request, issueTypeId, block, memory]);

  const issueType = prep?.issueTypes.find((type) => type.id === issueTypeId);
  const emptyRequired = inputs.filter(
    (input) => input.required && (valueOf(input) === undefined || valueOf(input) === null),
  );
  const cannotAsk = (prep?.missing ?? []).filter((name) => !inputs.some((input) => input.name === name));
  const canCreate = !!prep && !!issueType && !emptyRequired.length && !cannotAsk.length && !filing;

  const remember = async () => {
    const bump = (usage = {}, key) => (key ? {...usage, [key]: (usage[key] ?? 0) + 1} : usage);
    await setSetting(JIRA_MEMORY, {
      ...memory,
      lastBlock: block.trim(),
      lastParent: request.parentKey,
      blockByScreen: {...memory.blockByScreen, [screenKey]: block.trim()},
      parentByScreen: {...memory.parentByScreen, [screenKey]: request.parentKey},
      issueTypes: bump(memory.issueTypes, issueType?.id),
      linkTypes: issueType?.subtask ? memory.linkTypes : bump(memory.linkTypes, linkType),
      fields: {...memory.fields, ...chosen},
    });
  };

  const create = async () => {
    setFiling(true);
    try {
      const result = await backend.jira.file({
        ...request,
        issueTypeId: issueType.id,
        linkType: issueType.subtask ? undefined : linkType,
        fieldValues,
        screenshotPng: preview?.base64,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await remember();
      await recordA11yDecision(violation, {status: 'reported', jiraKey: result.key, jiraUrl: result.url});
      notification.success({
        title: t('jiraFiled', {key: result.key}),
        description: (
          <Button
            type="link"
            style={{padding: 0}}
            icon={<IconExternalLink size={14} />}
            onClick={() => openLink(result.url)}
          >
            {t('jiraOpenIssue')}
          </Button>
        ),
        duration: 8,
      });
      for (const warning of result.warnings) {
        notification.warning({title: result.key, description: warning, duration: 8});
      }
      onClose();
    } finally {
      setFiling(false);
    }
  };

  const blockOptions = [...new Set([...(settings?.blocks ?? []), ...Object.values(memory.blockByScreen ?? {})])]
    .filter((option) => option && option.toLowerCase().includes(block.toLowerCase()))
    .map((value) => ({value}));

  const body = !backend.available ? (
    <Alert type="info" showIcon title={t('jiraDesktopOnly')} />
  ) : settings && !configured ? (
    <div className={styles.setup}>
      <div className={styles.setupGlyph}>
        <IconBug size={28} />
      </div>
      <div className={styles.setupTitle}>{t('jiraNotSetUp')}</div>
      <div className={styles.setupHint}>{t('jiraNotSetUpHint')}</div>
      <Button type="primary" icon={<IconSettings size={16} />} onClick={() => setSettingsOpen(true)}>
        {t('jiraSettings')}
      </Button>
    </div>
  ) : (
    <Form layout="vertical" requiredMark={false} className={styles.form}>
      <div className={styles.row}>
        <Form.Item label={t('jiraBlock')} extra={t('jiraBlockHint')} className={styles.grow}>
          <AutoComplete
            value={block}
            options={blockOptions}
            onChange={setBlock}
            placeholder={t('jiraBlockPlaceholder')}
          />
        </Form.Item>
        <Form.Item
          label={t('jiraTask')}
          className={styles.grow}
          validateStatus={parentKey && !keyValid ? 'error' : ''}
          help={
            parentKey && !keyValid
              ? t('jiraTaskInvalid')
              : prep
                ? `${prep.parent.summary}${prep.parent.assignee ? ` — ${prep.parent.assignee}` : ''}`
                : t('jiraTaskHint')
          }
        >
          <Input value={parentKey} onChange={(e) => setParentKey(e.target.value)} placeholder="PROJ-123" />
        </Form.Item>
      </div>
      {loading && <Progress percent={100} status="active" showInfo={false} size="small" />}
      {error && <Alert type="error" showIcon title={error} className={styles.alert} />}
      <AnimatePresence>
        {prep && (
          <motion.div
            initial={{opacity: 0, height: 0}}
            animate={{opacity: 1, height: 'auto'}}
            exit={{opacity: 0, height: 0}}
            transition={{duration: 0.35, ease: [0.22, 1, 0.36, 1]}}
          >
            <div className={styles.row}>
              <Form.Item label={t('jiraIssueType')} className={styles.grow}>
                <Select
                  value={issueTypeId}
                  onChange={setIssueTypeId}
                  options={prep.issueTypes.map((type) => ({
                    value: type.id,
                    label: `${type.name}${type.subtask ? ` (${t('jiraSubtask')})` : ''}`,
                  }))}
                />
              </Form.Item>
              {issueType && !issueType.subtask && prep.linkTypes.length > 0 && (
                <Form.Item label={t('jiraLinkAs')} className={styles.grow}>
                  <Select
                    value={linkType}
                    onChange={setLinkType}
                    options={prep.linkTypes.map((name) => ({value: name, label: name}))}
                  />
                </Form.Item>
              )}
            </div>
            {issueType?.subtask && <p className={styles.muted}>{t('jiraAsSubtask', {key: prep.parent.key})}</p>}
            {inputs.map((input) => (
              <JiraFieldInput
                key={`${issueTypeId}-${input.id}`}
                input={input}
                chosen={chosen[input.id]}
                onChange={(value) =>
                  setChosen((current) => {
                    const next = {...current};
                    if (value) {
                      next[input.id] = value;
                    } else {
                      delete next[input.id];
                    }
                    return next;
                  })
                }
              />
            ))}
            {cannotAsk.length > 0 && (
              <Alert type="warning" showIcon title={t('jiraCannotAsk', {fields: cannotAsk.join(', ')})} />
            )}
            <div className={styles.preview}>
              {preview && <img src={preview.dataUrl} alt="" className={styles.previewShot} />}
              <div className={styles.previewText}>
                <div className={styles.previewSummary}>{prep.summary}</div>
                {prep.filled.map((item) => (
                  <div key={item.field} className={styles.muted}>
                    {item.field}: <span className={styles.previewValue}>{item.value}</span>
                    {item.source === 'task' ? ` (${t('jiraFromTask')})` : ''}
                  </div>
                ))}
                <Button
                  type="link"
                  size="small"
                  className={styles.descriptionToggle}
                  icon={<IconChevronDown size={14} className={showDescription ? styles.flip : ''} />}
                  onClick={() => setShowDescription((shown) => !shown)}
                >
                  {t('jiraDescription')}
                </Button>
                <AnimatePresence>
                  {showDescription && (
                    <motion.pre
                      className={styles.description}
                      initial={{opacity: 0, height: 0}}
                      animate={{opacity: 1, height: 'auto'}}
                      exit={{opacity: 0, height: 0}}
                    >
                      {prep.description}
                    </motion.pre>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Form>
  );

  return (
    <>
      <Modal
        open={open}
        title={
          <Space>
            <IconBug size={18} />
            {t('jiraCreateBug')}
          </Space>
        }
        width={680}
        onCancel={filing ? undefined : onClose}
        centered
        destroyOnHidden
        footer={
          configured
            ? (_, {CancelBtn}) => (
                <Space style={{width: '100%', justifyContent: 'space-between'}}>
                  <Button type="text" icon={<IconSettings size={16} />} onClick={() => setSettingsOpen(true)}>
                    {t('jiraSettings')}
                  </Button>
                  <Space>
                    <CancelBtn />
                    <Button type="primary" disabled={!canCreate} loading={filing} onClick={create}>
                      {t('jiraCreate')}
                    </Button>
                  </Space>
                </Space>
              )
            : null
        }
      >
        {body}
      </Modal>
      <JiraSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
};

export default JiraBugDialog;
