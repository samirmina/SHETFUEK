export const ALLOWED_DISPOSITIONS = [
  'customer_favorable',
  'system_favorable',
  'clarification_needed',
  'wrong_email'
];

export const DISPOSITION_GUIDANCE = {
  customer_favorable: {
    label: 'Customer Favorable',
    description: 'Resolution favors the customer (refund, credit, exception, waiver)',
    adminNotesGuidance: 'Admin notes should reflect customer-friendly outcome. Solution should describe the favorable resolution granted.'
  },
  system_favorable: {
    label: 'System Favorable',
    description: 'Resolution favors the system/company (policy enforcement, no refund, standard process)',
    adminNotesGuidance: 'Admin notes should reflect company policy adherence. Solution should describe standard process or policy enforcement.'
  },
  clarification_needed: {
    label: 'Clarification Needed',
    description: 'More information required from customer',
    adminNotesGuidance: 'Admin notes should specify what clarification is needed from the customer. Issue should describe the ambiguity.'
  },
  wrong_email: {
    label: 'Wrong Email/Queue',
    description: 'Ticket submitted to wrong queue/email',
    adminNotesGuidance: 'Admin notes should note misrouting and correct destination. Issue should describe the routing error.'
  }
};

export const ISSUE_TYPE_CATEGORIES = [
  'account',
  'payments',
  'parking',
  'hardware',
  'riding',
  'discounts',
  'legal',
  'user_non_compliance',
  'blocked_accounts',
  'activity_score'
];

export const TOPIC_KEYWORDS = {
  'PAYMENTS/DEBT': ['debt', 'owe', 'payment', 'charge', 'refund', 'eur', '€', '$', 'money', 'bill', 'invoice'],
  'PARKING/VEHICLE': ['abandon', 'park', 'vehicle', 'scooter', 'bike'],
  'ACCOUNT/LOGIN': ['login', 'password', 'account', 'access', 'verify'],
  'RIDING': ['ride', 'trip', 'journey', 'start', 'end', 'unlock'],
  'HARDWARE/SAFETY': ['helmet', 'safety', 'accident', 'damage', 'broken']
};

export const MIN_ADMIN_NOTES_LENGTH = {
  issue: 100,
  solution: 100,
  other: 50,
  supportingDocumentation: 50
};

export const ADMIN_NOTES_FALLBACKS = {
  issue: 'Customer reports an issue. No further details provided in the ticket.',
  solution: 'Review ticket and apply standard resolution based on selected disposition.',
  other: 'No additional context provided by customer.',
  supportingDocumentation: 'No supporting documentation provided by customer. Ticket based on customer statement only.'
};

export const RESPONSE_FORMATS = ['chat', 'email'];

export const RAG_CONFIG = {
  topK: 5,
  minScore: 0.35,
  weakScoreThreshold: 0.58
};

export const LLM_CONFIG = {
  maxAttempts: 3,
  defaultModel: 'llama3.2:3b',
  timeoutMs: 120000
};

export const CACHE_CONFIG = {
  maxSize: 1000,
  ttlMs: 3600000
};