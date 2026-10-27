import {STATION_SERVER} from './mcp-servers.js';

// What the station answers when Kiro asks permission for a tool, before the
// person is asked at all: the station's own read tools and read-only shell
// commands go through; writing files and shell commands that destroy or
// change the repositories are refused; any other command is the person's
// call, on a card that shows it (measuring the shell's start, say). The station picks
// only among the options Kiro offered, never one of its own.

// git that only reads
const GIT_READ =
  /^git\s+(?:-C\s+\S+\s+)?(status|log|diff|show|blame|grep|ls-files|ls-tree|rev-parse|describe|shortlog|cat-file|branch(?:\s+(?:-a|-r|--list|--show-current|-v+))*\s*$|remote\s+-v|tag\s+(?:-l|--list)|config\s+--get)\b/;
// other commands that only read
const SHELL_READ = /^(ls|cat|head|tail|wc|grep|rg|find|tree|pwd|file|stat|du|sort|uniq|cut|jq|awk|sed\s+-n)\b/;
// anything that may change something, even inside an allowed command
const SHELL_CHANGE =
  /(^|[;&|]\s*)(rm|mv|cp|mkdir|touch|chmod|chown|ln|tee|dd|curl|wget|npm|npx|yarn|pnpm|pip|brew|xcrun|adb|kill)\b|>|-delete\b|-exec\b|\bsed\s+-i\b/;

// refused without asking: what destroys, runs as root, writes files, or changes the repositories
// (their branches go through the station's own tools, with what a switch discards shown)
const SHELL_REFUSE =
  /(^|[;&|(]\s*)(sudo|su|rm|rmdir|mv|dd|chmod|chown|mkfs|diskutil|shutdown|reboot|killall|kill|launchctl|defaults\s+(?:write|delete))\b|\bgit\s+(?:-C\s+\S+\s+)?(push|reset|clean|checkout|switch|commit|rebase|merge|pull|stash|restore|rm|mv|apply|am|cherry-pick|revert|tag\s+-d|branch\s+-[dDmM])\b|\bsed\s+-i\b|-delete\b|>>?\s*(?!&|\/dev\/null\b)\S/;

const pick = (options, kinds) => options?.find((option) => kinds.includes(option.kind)) ?? null;

/** The shell command a permission request is about, if it is one. */
function shellCommand(request) {
  const consent = request._meta?.kiro?.consent ?? {};
  if (!/shell|command|exec|bash/i.test(`${consent.capability ?? ''} ${request.toolCall?.kind ?? ''}`)) {
    return null;
  }
  const raw = request.toolCall?.rawInput ?? {};
  return String(raw.command ?? raw.cmd ?? consent.resource ?? '').trim();
}

/** Whether a shell command only reads, by its first word and what follows. */
export function readOnlyCommand(command) {
  const text = String(command ?? '').trim();
  if (!text || SHELL_CHANGE.test(text)) {
    return false;
  }
  return text.split(/\s*(?:&&|\|\||;|\|)\s*/).every((part) => GIT_READ.test(part) || SHELL_READ.test(part));
}

/** Whether a shell command is refused without asking. */
export const refusedCommand = (command) => SHELL_REFUSE.test(String(command ?? ''));

/**
 * What to do with a permission request.
 * @param {object} request the params of `session/request_permission`
 * @param {{readTools: Set<string>}} station the station tools that only read
 * @returns {{action: 'allow' | 'reject' | 'ask', optionId?: string, reason?: string}}
 */
export function decidePermission(request, {readTools}) {
  const options = request.options ?? [];
  const allow = pick(options, ['allow_once']);
  const reject = pick(options, ['reject_once', 'reject_always']);
  const kiro = request._meta?.kiro ?? {};
  const identity = kiro.mcpTool?.identity;
  const capability = String(kiro.consent?.capability ?? '');

  if (identity?.serverName === STATION_SERVER) {
    if (readTools.has(identity.toolName) && allow) {
      return {action: 'allow', optionId: allow.optionId, reason: 'stationRead'};
    }
    return {action: 'ask'};
  }
  if (identity) {
    // another MCP server: its tools may do anything, the person decides
    return {action: 'ask'};
  }
  const command = shellCommand(request);
  if (command !== null) {
    if (readOnlyCommand(command) && allow) {
      return {action: 'allow', optionId: allow.optionId, reason: 'readCommand'};
    }
    if (refusedCommand(command) && reject) {
      return {action: 'reject', optionId: reject.optionId, reason: 'changeCommand'};
    }
    return {action: 'ask'};
  }
  if (/write|edit|delete|create|move/i.test(`${capability} ${request.toolCall?.kind ?? ''}`)) {
    return reject ? {action: 'reject', optionId: reject.optionId, reason: 'writeFiles'} : {action: 'ask'};
  }
  if (/read|search|fetch|think/i.test(`${capability} ${request.toolCall?.kind ?? ''}`) && allow) {
    return {action: 'allow', optionId: allow.optionId, reason: 'read'};
  }
  return {action: 'ask'};
}
