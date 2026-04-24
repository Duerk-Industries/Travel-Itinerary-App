import type { ParsedItemReviewState, ParsedItemType, UserVisibleFailureCode } from './contracts';

import { getEnvValue } from '../env';

export const INGESTION_LOGIC_VERSION = '2026.03.20.chase-flight-passengers';
export const INGESTION_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const INGESTION_SIGNED_URL_TTL_SECONDS = 15 * 60;
export const INGESTION_WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;
export const INGESTION_JOB_TOKEN_BUDGET_USD = 0.1;
export const INGESTION_CONFIDENCE_HIGH = 0.9;
export const INGESTION_CONFIDENCE_REVIEW_READY = 0.7;
export const INGESTION_OCR_MIN_CHAR_COUNT = 50;
/** Firestore single-field limit is 1,048,487 bytes; leave headroom for encoding overhead. */
export const INGESTION_MAX_NORMALIZED_TEXT_BYTES = 1_000_000;
export const INGESTION_DEFAULT_FORWARDING_ADDRESS = 'travel.docs@duerk.org';
export const INGESTION_DEFAULT_FORWARDING_PROVIDER = 'mailgun';
export const INGESTION_FORWARDING_SETTINGS_COPY =
  'Forward travel confirmations to the Mailgun-backed inbox. The displayed address can be copied by users, but changing the underlying destination requires an admin/provider update.';
export const INGESTION_JOB_QUEUE_MODE_DEFAULT = 'cloud_run';
export const INGESTION_RETRY_PROVIDER_GLOBAL = 'GLOBAL';
export const INGESTION_VIRUS_SCAN_PROVIDER_DEFAULT = 'cloud_native';
export const INGESTION_GMAIL_AUTH_EXPIRED_ALERT_THRESHOLD = 3;
export const INGESTION_GMAIL_AUTH_EXPIRED_ALERT_WINDOW_MINUTES = 15;

export const getIngestionForwardingAddress = (): string =>
  getEnvValue('INGESTION_FORWARDING_ADDRESS', {
    defaultValue: INGESTION_DEFAULT_FORWARDING_ADDRESS,
  })!;

export const INGESTION_SUPPORTED_MIME_TYPES = [
  'text/plain',
  'text/html',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
] as const;

export const INGESTION_RETRY_POLICY_DEFAULTS = {
  maxAttempts: 5,
  baseDelaySeconds: 30,
  maxDelaySeconds: 30 * 60,
  backoffStrategy: 'exponential_with_jitter',
  alertDeadLetterRatePercent: 5,
  alertWindowMinutes: 15,
  providerConsecutiveFailureThreshold: 5,
};

export const INGESTION_TIER_RULES = {
  free: {
    monthlyUploads: 0,
    gmailLookbackDays: 0,
    llmEscalations: 'NONE',
    gmailPollIntervalHours: null,
  },
  premium: {
    monthlyUploads: 50,
    gmailLookbackDays: 30,
    llmEscalations: 'SMALL_ONLY',
    gmailPollIntervalHours: 24,
  },
  pro: {
    monthlyUploads: 500,
    gmailLookbackDays: 90,
    llmEscalations: 'LARGE_ALLOWED',
    gmailPollIntervalHours: 4,
  },
} as const;

/**
 * Default interval between Gmail polling scheduler ticks. Each tick picks
 * connections whose `metadata.lastPolledAt` is older than the tier's
 * `gmailPollIntervalHours` and kicks off an ingestion pipeline for them.
 */
export const GMAIL_POLLING_TICK_INTERVAL_MS_DEFAULT = 15 * 60 * 1000;

export const INGESTION_FEATURE_FLAGS = {
  manualUpload: 'feature_ingest_manual_upload',
  forwardedMailbox: 'feature_ingest_forwarded_mailbox',
  gmailImport: 'feature_ingest_gmail_import',
  adminObservability: 'feature_ingest_admin_observability',
  localVirusScanStub: 'feature_ingest_local_virus_scan_stub',
} as const;

export const INGESTION_USAGE_KEYS = {
  manualUploads: 'ingestion_manual_uploads',
  gmailSyncs: 'ingestion_gmail_syncs',
  forwardedMailboxDeliveries: 'ingestion_forwarded_mailbox_deliveries',
  webhookSignatureFailures: 'ingestion_webhook_signature_failures',
  gmailAuthFailures: 'ingestion_gmail_auth_failures',
} as const;

export const INGESTION_REVIEW_QUEUE_ACTIVE_STATES: ParsedItemReviewState[] = [
  'LOW_CONFIDENCE',
  'READY_FOR_REVIEW',
  'DUPLICATE_FLAGGED',
];

export const INGESTION_TRAVEL_ITEM_LABELS: Record<ParsedItemType, string> = {
  flight: 'Flight',
  hotel: 'Hotel',
  rail: 'Rail',
  ferry_bus_transfer: 'Ferry/Bus Transfer',
  car_rental: 'Car Rental',
  tour_activity: 'Tour/Activity',
  restaurant_reservation: 'Restaurant Reservation',
  event_ticket: 'Event/Ticket',
  generic_note: 'Generic Note',
};

export const INGESTION_FAILURE_MESSAGES: Record<UserVisibleFailureCode, string> = {
  unsupported_file_type: 'This file type is not supported for travel ingestion.',
  file_too_large: 'This upload is larger than the 10MB ingestion limit.',
  duplicate_document: 'This document was already imported for your account.',
  parse_failed_try_again: 'We could not parse this document. Please try again or review it manually.',
  low_confidence_review_needed: 'We found travel details, but they need your review before assignment.',
  provider_auth_expired: 'The mailbox connection expired and needs to be reconnected.',
  gmail_permission_missing: 'Gmail read-only permission is required before import can run.',
  quota_exceeded: 'Your current plan has reached its ingestion quota.',
  virus_scan_failed: 'This document could not pass attachment safety checks.',
  mailbox_webhook_temporary_failure: 'The mailbox webhook failed temporarily. Please retry shortly.',
};
