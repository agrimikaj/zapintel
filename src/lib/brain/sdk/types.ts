export type StoreEventInput = {
  kind: string;
  occurredAt?: string;
  payload: Record<string, unknown>;
  tags?: string[];
  embedText?: string;
};

export type StorePatternInput = {
  scope: string;
  statement: string;
  confidence: number;
  supportingEventIds?: string[];
};

export type RecallInput = { query: string; scope?: string; patternLimit?: number };

export type Pattern = {
  id: string;
  scope: string;
  statement: string;
  confidence: string;
  appliedCount: number;
  distance?: number;
};

export type RecallResult = {
  patterns: Pattern[];
  identity: Record<string, unknown>;
};

export type BrainEvent = {
  id: string;
  kind: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  tags: string[];
};
