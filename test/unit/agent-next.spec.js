import {describe, expect, it} from 'vitest';

import {choiceSteps, cleanSteps, splitNextSteps, stepsOf} from '../../app/common/shared/agent/next-steps.js';

describe('next steps the operator offers', () => {
  it('takes the block off the answer and turns its lines into steps', () => {
    const answer = [
      'The limits screen sends GET /limits.',
      '',
      '<next-steps>',
      '- Check the limits screen :: Check the limits screen for the 422',
      '- File a bug :: File a bug about the 422 on /limits',
      '</next-steps>',
    ].join('\n');
    expect(splitNextSteps(answer)).toEqual({
      text: 'The limits screen sends GET /limits.',
      steps: [
        {label: 'Check the limits screen', message: 'Check the limits screen for the 422'},
        {label: 'File a bug', message: 'File a bug about the 422 on /limits'},
      ],
    });
  });

  it('hides a block still streaming, and leaves an answer without one as it is', () => {
    expect(splitNextSteps('Done.\n<next-steps>\n- Open the lo').text).toBe('Done.');
    expect(splitNextSteps('Just text')).toEqual({text: 'Just text', steps: []});
  });

  it('keeps up to four steps, each label once, a label alone sending itself', () => {
    const steps = cleanSteps([
      {label: ' Check limits ', message: 'Check the limits screen'},
      {label: 'Check limits', message: 'again'},
      {label: '', message: 'no label'},
      {label: 'A', message: 'a'},
      {label: 'B', message: 'b'},
      {label: 'C', message: 'c'},
    ]);
    expect(steps.map((step) => step.label)).toEqual(['Check limits', 'A', 'B', 'C']);
    expect(splitNextSteps('<next-steps>\nOpen the log\n</next-steps>').steps).toEqual([
      {label: 'Open the log', message: 'Open the log'},
    ]);
  });
});

describe('choices asked in the text', () => {
  const answer = [
    'Є три шляхи:',
    '',
    '- **Дозволити запуск.** Це команда з лімітом 30 с, яка нічого не пише.',
    '- **Запустити самому в терміналі** і надіслати мені вивід.',
    '- **Виправити без вимірів**, на підставі підозр.',
    '',
    'Який варіант обираєте?',
  ].join('\n');

  it('turns bold choices of a closing question into steps', () => {
    expect(choiceSteps(answer)).toEqual([
      {label: 'Дозволити запуск', message: 'Дозволити запуск'},
      {label: 'Запустити самому в терміналі', message: 'Запустити самому в терміналі'},
      {label: 'Виправити без вимірів', message: 'Виправити без вимірів'},
    ]);
  });

  it('leaves an answer that does not ask, or has one choice, without steps; a block wins', () => {
    expect(choiceSteps(answer.replace('Який варіант обираєте?', 'Готово.'))).toEqual([]);
    expect(choiceSteps('- **Одне.** текст\nТак?')).toEqual([]);
    expect(stepsOf(`${answer}\n<next-steps>\nA :: a\n</next-steps>`)).toEqual([{label: 'A', message: 'a'}]);
  });
});
