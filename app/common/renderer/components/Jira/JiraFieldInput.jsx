import {Form, Input, InputNumber, Select, Spin} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {backend} from '../../polyfills.js';

const userRef = (user) => (user.accountId ? {accountId: user.accountId} : {name: user.name ?? user.key});

const optionIds = (value) =>
  Array.isArray(value)
    ? value.map((item) => String(item.id))
    : value && typeof value === 'object' && 'id' in value
      ? [String(value.id)]
      : [];

/**
 * One field of a Jira bug: a person, an option, several options, a number or
 * text. Ported from vision's JiraFieldInput. The chosen value is kept in the
 * form Jira's create call takes, with the text to show for it.
 */
const JiraFieldInput = ({input, chosen, onChange}) => {
  const {t} = useTranslation();
  const value = chosen?.value ?? input.value;
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (input.type !== 'user' || query.trim().length < 2) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      const found = await backend.jira.findUsers(query.trim());
      if (!cancelled) {
        setPeople(found);
        setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [input.type, query]);

  const label = input.name;
  const required = input.required && (value === undefined || value === null);

  if (input.type === 'user') {
    const currentId = value?.accountId ?? value?.name;
    const shown = chosen?.display ?? input.display;
    return (
      <Form.Item label={label} required={input.required} validateStatus={required ? 'warning' : ''}>
        <Select
          showSearch
          allowClear
          filterOption={false}
          value={currentId}
          placeholder={t('jiraSearchPeople')}
          onSearch={setQuery}
          notFoundContent={searching ? <Spin size="small" /> : query.length < 2 ? t('jiraTypeName') : t('jiraNobody')}
          onChange={(id) => {
            const user = people.find((person) => (person.accountId ?? person.name) === id);
            onChange(user ? {value: userRef(user), display: user.displayName ?? ''} : undefined);
          }}
          options={[
            ...(currentId && !people.some((p) => (p.accountId ?? p.name) === currentId)
              ? [{value: currentId, label: shown || currentId}]
              : []),
            ...people.map((person) => ({value: person.accountId ?? person.name, label: person.displayName})),
          ]}
        />
      </Form.Item>
    );
  }

  if (input.type === 'option' || input.type === 'options') {
    const multiple = input.type === 'options';
    const ids = optionIds(value);
    return (
      <Form.Item label={label} required={input.required} validateStatus={required ? 'warning' : ''}>
        <Select
          mode={multiple ? 'multiple' : undefined}
          allowClear
          value={multiple ? ids : ids[0]}
          options={(input.options ?? []).map((option) => ({value: option.id, label: option.label}))}
          onChange={(picked) => {
            const pickedIds = [].concat(picked ?? []);
            const options = (input.options ?? []).filter((option) => pickedIds.includes(option.id));
            onChange(
              options.length
                ? {
                    value: multiple ? options.map((option) => ({id: option.id})) : {id: options[0].id},
                    display: options.map((option) => option.label).join(', '),
                  }
                : undefined,
            );
          }}
        />
      </Form.Item>
    );
  }

  if (input.type === 'number') {
    return (
      <Form.Item label={label} required={input.required} validateStatus={required ? 'warning' : ''}>
        <InputNumber
          style={{width: '100%'}}
          value={value ?? null}
          onChange={(number) => onChange(number === null ? undefined : {value: number, display: String(number)})}
        />
      </Form.Item>
    );
  }

  return (
    <Form.Item label={label} required={input.required} validateStatus={required ? 'warning' : ''}>
      <Input
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : {value: e.target.value, display: e.target.value})}
      />
    </Form.Item>
  );
};

export default JiraFieldInput;
