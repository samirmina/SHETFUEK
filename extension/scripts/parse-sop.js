const fs = require('fs');
const path = require('path');

const sourcePath = path.join(__dirname, '..', 'SOP_Reference_Macros_IssueTypes.json');
const outputPath = path.join(__dirname, '..', 'sop-data.json');

const raw = fs.readFileSync(sourcePath, 'utf-8');
const sopsSource = JSON.parse(raw);

function toId(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function toKeywords(name) {
  return name
    .split(/\s+/)
    .filter(w => w.length > 2 && w !== '::');
}

const prefixMap = {
  account: 'template_account_access',
  payments: 'template_payments',
  discounts: 'template_discounts',
  user_non_compliance: 'template_user_non_compliance',
  subscriptions: 'template_subscriptions',
  feedback: 'template_feedback',
  collaborations: 'template_collaborations',
  parking: 'template_vehicle_operations',
  hardware: 'template_vehicle_operations',
  riding: 'template_vehicle_operations',
  operations: 'template_vehicle_operations',
  livechat: 'template_vehicle_operations',
  phonesupport: 'template_vehicle_operations',
  in_appnavigation: 'template_vehicle_operations',
  legal: 'template_general',
  media: 'template_general',
  service_inquiries: 'template_general',
  service_enquiries: 'template_general',
  general: 'template_general'
};

const sops = [];
const macroMap = {};
const issueTypeMap = {};
let globalIssueId = 0;
let globalMacroId = 0;

let firstMacroId = null;

for (const src of sopsSource) {
  const sop = {
    sopName: src.sop_name || '',
    pageLink: src.page_link || '',
    issueTypes: [],
    macros: []
  };

  const macroIds = [];

  for (const macroName of src.macros || []) {
    const id = toId(macroName);
    if (!macroMap[id]) {
      macroMap[id] = {
        id,
        title: macroName,
        body: '',
        incomplete: true,
        variants: {}
      };
      globalMacroId++;
      if (!firstMacroId) firstMacroId = id;
    }
    macroIds.push(id);
    if (!sop.macros.includes(id)) {
      sop.macros.push(id);
    }
  }

  for (const issueName of src.issue_types || []) {
    const id = toId(issueName);
    if (!issueTypeMap[id]) {
      const keywords = toKeywords(issueName);
      let matchedTemplate = 'template_general';
      for (const prefix in prefixMap) {
        if (id.startsWith(prefix)) {
          matchedTemplate = prefixMap[prefix];
          break;
        }
      }
      issueTypeMap[id] = {
        id,
        name: issueName,
        priority: ++globalIssueId,
        rules: {
          subjectKeywords: keywords,
          bodyKeywords: [],
          zendeskTags: [],
          fmFlags: []
        },
        relatedMacros: macroIds.slice(),
        macroId: macroIds.length > 0 ? macroIds[0] : null,
        supplementBlocks: [],
        adminNoteTemplate: matchedTemplate
      };
    } else {
      const existing = issueTypeMap[id];
      for (const mid of macroIds) {
        if (!existing.relatedMacros.includes(mid)) {
          existing.relatedMacros.push(mid);
        }
      }
      if (!existing.macroId && macroIds.length > 0) {
        existing.macroId = macroIds[0];
      }
    }
    if (!sop.issueTypes.includes(id)) {
      sop.issueTypes.push(id);
    }
  }

  sops.push(sop);
}

const issueTypes = Object.values(issueTypeMap).sort((a, b) => a.priority - b.priority);

const firstMacroIdVal = firstMacroId;

const sopData = {
  sops,
  issueTypes,
  macros: macroMap,
  supplementBlocks: {},
  adminNoteTemplates: {
    template_vehicle_operations: {
      issue: '* Issue: {issue_type} reported by customer (Ticket {ticket_id}).',
      solution: '* Solution: Resolved per SOP guidelines for {issue_type}.',
      other: '* Other: User {user_id} | {city}, {country} | Partner: {partner} | Compensation: {compensation} | FM flags: {fm_flags} | Page: {page_type} | Entity: {entity_id}.',
      supportingDocumentation: '* Supporting documentation: {documented_data}'
    },
    template_account_access: {
      issue: '* Issue: Account/access issue reported by customer (Ticket {ticket_id}).',
      solution: '* Solution: Guided customer through resolution per SOP guidelines.',
      other: '* Other: User {user_id} | {city}, {country} | Partner: {partner} | Compensation: {compensation} | Language: {language} | IVC: {ivc}.',
      supportingDocumentation: '* Supporting documentation: {documented_data}'
    },
    template_payments: {
      issue: '* Issue: Payment/charge issue reported by customer (Ticket {ticket_id}).',
      solution: '* Solution: Investigated payment record and resolved per SOP guidelines.',
      other: '* Other: User {user_id} | {city}, {country} | Partner: {partner} | Compensation: {compensation} | Requester: {requester_email}.',
      supportingDocumentation: '* Supporting documentation: {documented_data}'
    },
    template_discounts: {
      issue: '* Issue: Discount/promotion query reported by customer (Ticket {ticket_id}).',
      solution: '* Solution: Verified discount eligibility and explained per SOP guidelines.',
      other: '* Other: User {user_id} | {city}, {country} | Partner: {partner} | Compensation: {compensation} | Language: {language}.',
      supportingDocumentation: '* Supporting documentation: {documented_data}'
    },
    template_user_non_compliance: {
      issue: '* Issue: User non-compliance/ASB report (Ticket {ticket_id}).',
      solution: '* Solution: Reviewed user behaviour and applied SOP guidelines.',
      other: '* Other: User {user_id} | {city}, {country} | Partner: {partner} | Compensation: {compensation} | FM flags: {fm_flags}.',
      supportingDocumentation: '* Supporting documentation: {documented_data}'
    },
    template_subscriptions: {
      issue: '* Issue: Subscription/Voi Pass query reported by customer (Ticket {ticket_id}).',
      solution: '* Solution: Verified subscription status and resolved per SOP guidelines.',
      other: '* Other: User {user_id} | {city}, {country} | Partner: {partner} | Compensation: {compensation} | Language: {language} | IVC: {ivc}.',
      supportingDocumentation: '* Supporting documentation: {documented_data}'
    },
    template_feedback: {
      issue: '* Issue: General feedback/operations feedback reported by customer (Ticket {ticket_id}).',
      solution: '* Solution: Acknowledged feedback and resolved per SOP guidelines.',
      other: '* Other: User {user_id} | {city}, {country} | Partner: {partner} | Compensation: {compensation}.',
      supportingDocumentation: '* Supporting documentation: {documented_data}'
    },
    template_collaborations: {
      issue: '* Issue: Collaboration/partner inquiry reported (Ticket {ticket_id}).',
      solution: '* Solution: Processed request per SOP guidelines.',
      other: '* Other: User {user_id} | {city}, {country} | Partner: {partner} | Compensation: {compensation}.',
      supportingDocumentation: '* Supporting documentation: {documented_data}'
    },
    template_general: {
      issue: '* Issue: General support request (Ticket {ticket_id}).',
      solution: '* Solution: Resolved per SOP guidelines.',
      other: '* Other: User {user_id} | {city}, {country} | Partner: {partner} | Compensation: {compensation}.',
      supportingDocumentation: '* Supporting documentation: {documented_data}'
    }
  },
  compensationTypes: {
    credit: 'account credit',
    voucher: 'voucher',
    refund: 'refund'
  }
};

fs.writeFileSync(outputPath, JSON.stringify(sopData, null, 2));
console.log('Generated sop-data.json with ' + issueTypes.length + ' issue types and ' + Object.keys(macroMap).length + ' macros across ' + sops.length + ' SOPs');
