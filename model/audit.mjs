export function compactModelAudit(role, audit, extra = {}) {
  const requestBody = audit?.request?.body;
  const input = Array.isArray(requestBody?.input) ? requestBody.input : [];
  return {
    role,
    ...extra,
    id: audit?.id ?? null,
    startedAt: audit?.startedAt ?? null,
    model: audit?.model ?? null,
    reasoningEffort: requestBody?.reasoning?.effort ?? null,
    requestSent: Boolean(audit?.requestSent),
    responseStatus: audit?.responseStatus ?? null,
    elapsedMs: audit?.elapsedMs ?? 0,
    headersReceivedMs: audit?.headersReceivedMs ?? null,
    firstEventMs: audit?.firstEventMs ?? null,
    firstTextMs: audit?.firstTextMs ?? null,
    streamedResponse: Boolean(audit?.streamedResponse),
    eventsReceived: audit?.eventsReceived ?? 0,
    finishReason: audit?.finishReason ?? null,
    incompleteReason: audit?.incompleteReason ?? null,
    usage: audit?.usage ?? null,
    error: audit?.error ?? null,
    request: {
      model: requestBody?.model ?? null,
      messageCount: input.length,
      inputCharacters: input.reduce((sum, message) => sum + String(message?.content ?? '').length, 0),
    },
    responseCharacters: typeof audit?.rawResponse === 'string' ? audit.rawResponse.length : null,
  };
}
