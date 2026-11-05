import { callModel } from '../model/model-client.mjs';
import { compactModelAudit } from '../model/audit.mjs';

export function createModelGateway({ configLoader, fetchImpl, requestTimeoutMs, audit }) {
  return {
    connect() {
      const { llm } = configLoader();
      const bounded = llm.timeoutMs == null ? { ...llm, timeoutMs: requestTimeoutMs } : llm;
      return async ({ role, metadata, ...request }) => {
        const response = await callModel({ ...request, llm: bounded, fetchImpl });
        const summary = compactModelAudit(role, response.audit, metadata);
        audit(summary);
        return { ...response, audit: summary };
      };
    },
  };
}
