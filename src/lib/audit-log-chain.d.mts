export type AuditChainVerification = {
  valid: boolean;
  checked: number;
  unsealed: number;
  brokenEventId: string | null;
  reason: string;
};
export function sealNewAuditEvents<T extends Record<string, any>>(events: T[], actorId?: string): Promise<{
  events: T[];
  changed: boolean;
  tampered: boolean;
  verification: AuditChainVerification;
}>;
export function verifyAuditChain(events: Array<Record<string, any>>): Promise<AuditChainVerification>;
export function auditChainCsv(events: Array<Record<string, any>>): Promise<string>;
