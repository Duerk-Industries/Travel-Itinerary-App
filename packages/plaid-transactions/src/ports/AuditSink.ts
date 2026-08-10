export interface AuditEvent {
  type: string;
  userId: string;
  itemId?: string;
  metadata?: Record<string, any>;
  timestamp: Date;
}

export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}
