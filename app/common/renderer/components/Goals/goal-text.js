// A goal in a few words, for its row and its card: what it checks, where.

export function goalSummary(goal, t) {
  const {type, params} = goal;
  const endpoint = [params.method, params.path].filter(Boolean).join(' ');
  switch (type) {
    case 'request':
      return t('goalSummary_request', {endpoint});
    case 'field':
      return t('goalSummary_field', {
        endpoint,
        // i18next reads a dot as a path, so request.body is request_body there
        where: t(`goalValue_${params.where.replace('.', '_')}`),
        field: params.field,
        op: t(`goalValue_${params.op}`),
        value: params.value,
      });
    case 'status':
      return t('goalSummary_status', {endpoint, status: params.status});
    case 'log':
      return t(params.mode === 'notSeen' ? 'goalSummary_logNot' : 'goalSummary_log', {
        pattern: params.pattern,
        tag: params.tag || '*',
      });
    case 'screen':
      return t('goalSummary_screen', {screen: [params.screen, params.state].filter(Boolean).join(' · ')});
    case 'noFlags':
      return t('goalSummary_noFlags', {endpoint});
    default:
      return t('goalSummary_manual');
  }
}
