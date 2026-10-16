# Zendesk Assistant — Clean Architecture Redesign

## Problem Statement
Current codebase has:
- Fragmented data extraction (zendesk.js, fm.js with brittle selectors)
- No feedback loop: user changes in popup don't trigger re-classification
- Admin notes generated without regard to user's disposition selection
- Issue type / macro / disposition mapping is unclear
- Macro tied to unknown element in code
- LLM prompt engineering scattered across multiple files

## New Architecture: Clean Layered Design

```
┌─────────────────────────────────────────────────────────────────┐
│                        POPUP UI (popup.js)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Ticket View  │  │ Classify UI  │  │ Response UI  │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
└─────────┼─────────────────┼─────────────────┼──────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                   BACKGROUND (background.js)                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Orchestration Layer                          │   │
│  │  • fetchTicketData() → TicketContext                      │   │
│  │  • fetchFmData() → FmContext                              │   │
│  │  • classify(context, userOverrides) → Classification      │   │
│  │  • reclassify(userChanges) → Updated Classification       │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ HTTP POST /api/classify
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                  NATIVE HOST (host.js + http_server.js)         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  HTTP Server │  │  Classifier  │  │    RAG       │          │
│  │  (port 27183)│──▶│  Pipeline    │──▶│  (vector DB) │          │
│  └──────────────┘  └──────┬───────┘  └──────────────┘          │
│                           │                                     │
│                    ┌──────┴───────┐                             │
│                    │   Prompt     │                             │
│                    │   Engine     │                             │
│                    └──────────────┘                             │
└─────────────────────────────────────────────────────────────────┘
```

## Data Contracts

### TicketContext (from zendesk.js)
```json
{
  "ticketId": "123456",
  "subject": "Customer complaint about debt",
  "body": "Full ticket text...",
  "requesterEmail": "user@example.com",
  "requesterPhone": "+33123456789",
  "language": "fr",
  "userId": "789012",
  "ivc": "score: 85",
  "tags": ["billing", "debt"],
  "status": "open",
  "structured": {
    "country": "France",
    "city": "Paris",
    "partner": "VOI Customer",
    "compensation": "N/A",
    "issueType": ""
  },
  "publicReply": "Agent's draft reply...",
  "internalNote": "Previous admin notes...",
  "fmIdentifier": "rider_abc123"
}
```

### FmContext (from fm.js)
```json
{
  "pageType": "profile",
  "entityId": "rider_abc123",
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+33123456789",
  "city": "Paris",
  "country": "France",
  "partner": "VOI Customer",
  "flags": ["refund_eligible", "service_incomplete"],
  "serviceEntries": [...],
  "transactionHistory": [...],
  "rawText": "Full page text..."
}
```

### UserOverrides (from popup user selections)
```json
{
  "issueTypeId": "payments_debt_other",           // User selected from dropdown
  "macroId": "payments_debt_refund_partial",      // User selected from dropdown
  "dispositions": ["customer_favorable"],         // User clicked chips
  "responseFormat": "email"                       // User selected radio
}
```

### ClassificationResult (LLM output + validation)
```json
{
  "issueTypeId": "payments_debt_other",
  "macroId": "payments_debt_refund_partial",
  "responseFormat": "email",
  "extractedLines": ["Customer owes €45.50 from ride on 2024-01-15"],
  "greeting": "Hi John,",
  "signOff": "Best regards,",
  "dispositions": ["customer_favorable"],
  "confidence": 0.92,
  "adminNotes": {
    "issue": "Customer reports being charged for a ride they didn't take. Dispute over €45.50 debt from Jan 15 ride.",
    "solution": "Refund the disputed charge of €45.50 as customer_favorable resolution per policy.",
    "other": "Customer ID: 789012, IVC score: 85, Partner: VOI Customer, Language: French",
    "supportingDocumentation": "No supporting documentation provided by customer. Ticket based on customer statement only."
  },
  "reasoning": "Customer message clearly indicates disputed charge. RAG matches payments_debt category. User selected customer_favorable disposition.",
  "validationErrors": null
}
```

## Key Design Principles

### 1. Single Source of Truth for Issue Types
- Load `sop-data.json` → normalize to flat list of `{ id, name, category, relatedMacros, sopName }`
- Categories: `account`, `payments`, `parking`, `hardware`, `riding`, `discounts`, `legal`, `user_non_compliance`, `blocked_accounts`, `activity_score`
- Issue type ID format: `{category}_{subcategory}_{specific}`

### 2. Macro Mapping
- Macro IDs normalized: `Account::Delete::Confirmation` → `account_delete_confirmation`
- Each issue type has `relatedMacros` array from SOP
- LLM can only pick macro from issue type's relatedMacros (or null)

### 3. Disposition-Driven Admin Notes
- Dispositions: `customer_favorable`, `system_favorable`, `clarification_needed`, `wrong_email`
- When user selects disposition → re-classify with `userOverrides.dispositions`
- LLM generates admin notes CONSISTENT with selected disposition
- System prompt includes disposition guidance

### 4. Re-classification on User Changes
```
User changes issue type in dropdown
       │
       ▼
Popup sends reclassify request with userOverrides
       │
       ▼
Background calls native host with userOverrides
       │
       ▼
Native host runs LLM with userOverrides as constraints
       │
       ▼
Returns updated ClassificationResult
       │
       ▼
Popup updates all fields (macro, admin notes, response)
```

### 5. Admin Notes Requirements (Enforced)
| Field | Min Length | Language | Fallback |
|-------|-----------|----------|----------|
| issue | 100 chars | English | "Customer reports [summary]. No further details provided." |
| solution | 100 chars | English | "Review ticket and apply standard [disposition] resolution." |
| other | 50 chars | English | "No additional context provided by customer." |
| supportingDocumentation | 50 chars | English | "No supporting documentation provided by customer. Ticket based on customer statement only." |

## File Structure (New)

```
extension/
├── content/
│   ├── scraper.js           # Unified page scraper base class
│   ├── zendesk-scraper.js   # Zendesk-specific extraction
│   ├── fm-scraper.js        # FM-specific extraction
│   └── index.js             # Message handlers
├── popup/
│   ├── popup.html
│   ├── popup.js             # Main UI controller
│   ├── ui/
│   │   ├── ticket-view.js
│   │   ├── classify-panel.js
│   │   ├── response-panel.js
│   │   └── admin-notes-panel.js
│   └── state/
│       └── app-state.js     # Centralized state management
├── background/
│   ├── background.js        # Message router
│   ├── orchestrator.js      # Classification orchestration
│   ├── ticket-fetcher.js    # Fetch ticket + FM data
│   └── classifier-client.js # Native host HTTP client
├── native-host/
│   ├── host.js              # Entry point, HTTP server starter
│   ├── http-server.js       # HTTP API (/classify, /ping, /ingest)
│   ├── classifier/
│   │   ├── index.js         # Main classify() function
│   │   ├── validate.js      # Parse + validate LLM output
│   │   └── retry.js         # Retry logic with corrective prompts
│   ├── prompt/
│   │   ├── index.js         # buildPrompt(), buildRetryPrompt()
│   │   ├── system.js        # System prompt template
│   │   └── user.js          # User prompt template
│   ├── rag/
│   │   ├── index.js         # query(), buildIndex()
│   │   ├── store.js         # Vector store
│   │   └── ingest.js        # SOP/macro ingestion
│   ├── data/
│   │   ├── issue-types.js   # Load & normalize SOP issue types
│   │   └── macros.js        # Load & normalize macros
│   ├── cache/
│   │   └── ticket-cache.js
│   └── logs/
│       └── logger.js
└── shared/
    ├── constants.js         # ALLOWED_DISPOSITIONS, categories, etc.
    ├── types.js             # TypeScript-like type definitions (JSDoc)
    └── utils.js             # Helper functions
```

## Implementation Order

1. **Shared constants & types** - Foundation
2. **Native host data layer** - issue-types.js, macros.js
3. **Native host classifier** - validate.js, retry.js, index.js
4. **Native host prompt engine** - system.js, user.js, index.js
5. **Native host HTTP server** - Clean API
6. **Content scrapers** - Unified base + zendesk/fm
7. **Background orchestrator** - fetch + classify + reclassify
8. **Popup UI** - State management + panels + reclassify on change
9. **Integration testing** - End-to-end verification
