export const agentNamePattern = /^[A-Za-z0-9_-]{1,64}$/;

export function isAgentName(name: string): boolean {
  return agentNamePattern.test(name);
}
