import {endpointOf} from '../../../shared/findings/traffic-rules.js';

// How a picked request or log line is named in a chip: an id the agent's
// tools know, and a few words the person recognizes.

export const exchangePick = (exchange) => {
  const {path} = endpointOf(exchange.url);
  return {id: exchange.id, label: `${exchange.method} ${path} ${exchange.status ?? '…'}`};
};

export const logPick = (entry) => ({
  id: String(entry.seq),
  label: `${entry.level} ${entry.tag}: ${String(entry.message ?? '')
    .split('\n')[0]
    .slice(0, 60)}`,
});
