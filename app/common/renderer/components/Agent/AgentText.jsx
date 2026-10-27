import styles from './Agent.module.css';

// The agent writes Markdown. A small part of it is shown as such: code
// blocks, lists, `code` and **bold**; the rest stays text. Nothing is put in
// as HTML, so nothing the agent writes can run in the window.

const inline = (text, keyBase) =>
  text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => {
    const key = `${keyBase}-${index}`;
    if (/^`[^`]+`$/.test(part)) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <b key={key}>{part.slice(2, -2)}</b>;
    }
    return part;
  });

const AgentText = ({text}) => {
  const blocks = [];
  const lines = String(text ?? '').split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith('```')) {
      const code = [];
      while (++index < lines.length && !lines[index].startsWith('```')) {
        code.push(lines[index]);
      }
      blocks.push(
        <pre key={`pre-${index}`} className={styles.code}>
          {code.join('\n')}
        </pre>,
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[index])) {
        // the line number names the item
        items.push({line: index, text: lines[index].replace(/^\s*([-*]|\d+\.)\s+/, '')});
        index++;
      }
      index--;
      blocks.push(
        <ul key={`ul-${index}`} className={styles.list}>
          {items.map((item) => (
            <li key={item.line}>{inline(item.text, `li-${item.line}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (/^#{1,4}\s/.test(line)) {
      blocks.push(
        <p key={`h-${index}`} className={styles.heading}>
          {inline(line.replace(/^#+\s/, ''), `h-${index}`)}
        </p>,
      );
      continue;
    }
    if (line.trim()) {
      blocks.push(<p key={`p-${index}`}>{inline(line, `p-${index}`)}</p>);
    }
  }
  return <div className={styles.text}>{blocks}</div>;
};

export default AgentText;
