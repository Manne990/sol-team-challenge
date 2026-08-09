export const companyLifecycles = [
  "lead",
  "prospect",
  "customer",
  "inactive",
] as const;
export type CompanyLifecycle = (typeof companyLifecycles)[number];

export interface Company {
  id: string;
  name: string;
  organizationNumber: string | null;
  externalReference: string | null;
  website: string | null;
  phone: string | null;
  industry: string | null;
  size: string | null;
  address: Record<string, string>;
  lifecycleStatus: CompanyLifecycle;
  owner: { id: string; name: string } | null;
  tags: string[];
  description: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  version: number;
}

export interface CompanyDetail extends Company {
  relatedCounts: {
    contacts: number;
    activities: number;
    deals: number;
    tasks: number;
  };
  history: Array<{
    action: string;
    timestamp: string;
    summary: Record<string, unknown>;
  }>;
  activities?: Array<{
    id: string;
    type: string;
    subject: string;
    body: string;
    occurredAt: string;
    creatorLabel: string;
    followUpTaskId: string | null;
  }>;
}

export interface CompanyInput {
  name: string;
  organizationNumber?: string | null;
  externalReference?: string | null;
  website?: string | null;
  phone?: string | null;
  industry?: string | null;
  size?: string | null;
  address?: Record<string, string>;
  lifecycleStatus: CompanyLifecycle;
  ownerMembershipId?: string | null;
  tags?: string[];
  description?: string;
  version?: number;
}
