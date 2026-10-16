self.__rules = self.__rules || {};

async function loadSopData() {
  if (self.__sopData) return self.__sopData;
  try {
    const url = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL
      ? chrome.runtime.getURL('sop-data.json')
      : 'sop-data.json';
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to load SOP data');
    self.__sopData = await response.json();
    return self.__sopData;
  } catch (error) {
    console.error('Error loading SOP data:', error);
    return null;
  }
}

self.__rules.loadSopData = loadSopData;

self.__rules.textMatchesKeywords = function textMatchesKeywords(text, keywords) {
  if (!text || !keywords || keywords.length === 0) return false;
  const lowerText = text.toLowerCase();
  return keywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
};

self.__rules.arrayContainsAny = function arrayContainsAny(array, keywords) {
  if (!array || !keywords || keywords.length === 0) return false;
  const flat = array.join(' ').toLowerCase();
  return keywords.some(keyword => flat.includes(keyword.toLowerCase()));
};

self.__rules.detectPartner = function detectPartner(headerText) {
  if (!headerText) return 'VOI Customer';
  const lower = headerText.toLowerCase();

  const partners = [
    { name: 'ASEAG (MOV A)', patterns: ['aseag', 'mov a'] },
    { name: 'Free Now', patterns: ['free now'] },
    { name: 'HVV Switch', patterns: ['hvv switch', 'hochbahn', 'hvv'] },
    { name: 'Jelbi', patterns: ['jelbi'] },
    { name: 'KVV', patterns: ['kvv'] },
    { name: 'Leipzig (GO) / (LVB)', patterns: ['leipzig', 'go)', 'lvb'] },
    { name: 'MEEP', patterns: ['meep'] },
    { name: 'Reach Now (Movl)', patterns: ['reach now', 'movl'] },
    { name: 'REDY', patterns: ['redy'] },
    { name: 'Rheinbahn', patterns: ['rheinbahn'] },
    { name: 'Ruter', patterns: ['ruter'] },
    { name: 'SBB / (YUMUV)', patterns: ['sbb', 'yumuv'] },
    { name: 'Splyt', patterns: ['splyt'] },
    { name: 'SWM / (MVGO)', patterns: ['swm', 'mvgo'] },
    { name: 'Telepass', patterns: ['telepass'] },
    { name: 'Travis (NOBINA)', patterns: ['travis', 'nobina'] },
    { name: 'Trafi (SOLENT)', patterns: ['trafi', 'solent'] },
    { name: 'Urbi', patterns: ['urbi'] },
    { name: 'VAG (PT) (NUREMBERG)', patterns: ['vag', 'nuremberg'] },
    { name: 'WeTaxi', patterns: ['wetaxi', 'we taxi'] },
    { name: 'WHIM', patterns: ['whim'] },
    { name: 'Hyre', patterns: ['hyre'] }
  ];

  for (const partner of partners) {
    for (const pattern of partner.patterns) {
      if (lower.indexOf(pattern) !== -1) {
        return partner.name;
      }
    }
  }

  if (lower.indexOf('rider') !== -1) {
    return 'VOI Customer';
  }

  return 'VOI Customer';
};

self.__rules.determineCompensation = function determineCompensation(ticketData, fmData) {
  if (fmData && fmData.flags && fmData.flags.indexOf('refund_eligible') !== -1) return 'refund';
  if (fmData && fmData.flags && fmData.flags.indexOf('voucher_available') !== -1) return 'discount/voucher';

  const issueType = ticketData.structured && ticketData.structured.issueType || '';
  const body = (ticketData.body || '').toLowerCase();
  const subject = (ticketData.subject || '').toLowerCase();
  const text = subject + ' ' + body;

  const refundKeywords = ['refund', 'money back', 'return payment'];
  const creditKeywords = ['credit', 'account credit', 'wallet credit'];
  const voucherKeywords = ['voucher', 'discount code', 'promo code'];

  if (refundKeywords.some(k => text.includes(k))) return 'refund';
  if (voucherKeywords.some(k => text.includes(k))) return 'discount/voucher';
  if (creditKeywords.some(k => text.includes(k))) return 'credits';

  return 'N/A';
};

self.__rules.resolveMetadata = function resolveMetadata(ticketData, fmData, issueType, sopData) {
  if (!ticketData) return null;

  const structured = ticketData.structured || {};

  let compensation = structured.compensation || 'false';
  if (fmData && fmData.flags && fmData.flags.indexOf('refund_eligible') !== -1) compensation = 'true';
  if (fmData && fmData.flags && fmData.flags.indexOf('voucher_available') !== -1) compensation = 'true';

  let partner = structured.partner || 'false';

  let country = structured.country || '';
  if (!country && fmData && fmData.country) country = fmData.country;
  if (!country && fmData && fmData.region) country = fmData.region;

  let city = structured.city || '';
  if (!city && fmData && fmData.city) city = fmData.city;

  return {
    country: country,
    city: city,
    partner: partner,
    compensation: compensation
  };
};
