// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SolvingHealth. Licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0
/**
 * @solvinghealth/suspension-kit — deadlines.mjs
 *
 * Pure calendar-day arithmetic and verbatim regulatory citations for a Medicare
 * payment suspension under 42 CFR Part 405, Subpart C (42 CFR 405.370–405.375)
 * and overpayment reporting under 42 CFR 401.305.
 *
 * Read directly from eCFR (https://www.ecfr.gov) on 2026-10-23:
 * - 42 CFR 405.374(a): "Except as provided in paragraph (b) of this section, the
 *   provider or supplier has at least 15 days following the date of notification
 *   to submit the statement." (The regulation says "15 days" — calendar days, not
 *   business days — starting with the date of notification, unless shortened or
 *   extended for cause under § 405.374(b).)
 * - 42 CFR 405.375(a): "CMS, the intermediary, or carrier must within 15 days,
 *   from the date the statement is received, consider the statement (including any
 *   pertinent evidence submitted), together with any other material bearing upon
 *   the case, and determine whether the facts justify the suspension, offset, or
 *   recoupment or, if already initiated, justify the termination of the suspension,
 *   offset, or recoupment."
 * - 42 CFR 405.375(c): "A determination made under paragraph (a) of this section
 *   is not an initial determination and is not appealable."
 *
 * General regulatory information only; not legal, medical, coding, or billing advice.
 */

export const KIT_VERSION = '1.0.0';
export const READ_DATE = '2026-10-23';
export const ECFR_SUBPART_C_URL = 'https://www.ecfr.gov/current/title-42/part-405/subpart-C';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Parse and validate an ISO-8601 calendar date string (YYYY-MM-DD) in UTC.
 * Rejects impossible calendar dates such as 2026-02-29 or 2026-02-30.
 */
export function parseIsoDateUtc(str) {
  if (typeof str !== 'string') return null;
  const trimmed = str.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1996 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

export function formatIsoDateUtc(dt) {
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addCalendarDays(isoDate, days) {
  const dt = parseIsoDateUtc(isoDate);
  if (!dt || !Number.isInteger(days)) return null;
  const next = new Date(dt.getTime() + days * 86400000);
  return formatIsoDateUtc(next);
}

export function dayOfWeekUtc(isoDate) {
  const dt = parseIsoDateUtc(isoDate);
  if (!dt) return null;
  const dow = dt.getUTCDay();
  return {
    index: dow,
    name: DAY_NAMES[dow],
    is_weekend: dow === 0 || dow === 6,
  };
}

/**
 * If a calendar-day deadline falls on a Saturday or Sunday, return the preceding
 * Friday so a practice delivering a rebuttal has it in the contractor's hands
 * before the 15th calendar day ends.
 */
export function precedingBusinessDayIfWeekend(isoDate) {
  const dow = dayOfWeekUtc(isoDate);
  if (!dow) return null;
  if (dow.index === 6) return addCalendarDays(isoDate, -1);
  if (dow.index === 0) return addCalendarDays(isoDate, -2);
  return isoDate;
}

export const REGULATORY_RULES = [
  {
    section: '42 CFR 405.370',
    title: 'Definitions — Suspension of payment & Credible allegation of fraud',
    day_count: null,
    day_type: null,
    clock_start: null,
    quote:
      'Suspension of payment. The withholding of payment by a Medicare contractor from a provider or supplier ... before a determination of the amount of the overpayment exists, or until the resolution of an investigation of a credible allegation of fraud.',
    source_url: 'https://www.ecfr.gov/current/title-42/part-405/section-405.370',
    checked_date: READ_DATE,
  },
  {
    section: '42 CFR 405.371(a)',
    title: 'General rules — Suspension in whole or in part',
    day_count: null,
    day_type: null,
    clock_start: null,
    quote:
      'Medicare payments to providers and suppliers, as authorized under this subchapter (excluding payments to beneficiaries), may be one of the following: (1) Suspended, in whole or in part, by CMS or a Medicare contractor if CMS or the Medicare contractor possesses reliable information that an overpayment exists or that the payments to be made may not be correct, although additional information may be needed for a determination. (2) In cases of suspected fraud, suspended, in whole or in part, by CMS or a Medicare contractor if CMS or the Medicare contractor has consulted with the OIG, and, as appropriate, the Department of Justice, and determined that a credible allegation of fraud exists against a provider or supplier, unless there is good cause not to suspend payments.',
    source_url: 'https://www.ecfr.gov/current/title-42/part-405/section-405.371',
    checked_date: READ_DATE,
  },
  {
    section: '42 CFR 405.371(b)(1)',
    title: 'Good cause exceptions — Full or partial relief from payment suspension',
    day_count: null,
    day_type: null,
    clock_start: null,
    quote:
      'CMS may find that good cause exists not to suspend payments or not to continue to suspend payments to an individual or entity against which there are credible allegations of fraud if— (i) OIG or other law enforcement agency has specifically requested that a payment suspension not be imposed because such a payment suspension may compromise or jeopardize an investigation; (ii) It is determined that beneficiary access to items or services would be so jeopardized by a payment suspension in whole or part as to cause a danger to life or health; (iii) It is determined that other available remedies implemented by CMS or a Medicare contractor more effectively or quickly protect Medicare funds than would implementing a payment suspension; or (iv) CMS determines that a payment suspension or a continuation of a payment suspension is not in the best interests of the Medicare program.',
    source_url: 'https://www.ecfr.gov/current/title-42/part-405/section-405.371',
    checked_date: READ_DATE,
  },
  {
    section: '42 CFR 405.372(a)-(d)',
    title: 'Proceeding for suspension of payment — Notice, rebuttal without prior notice, and 180-day limit',
    day_count: 180,
    day_type: 'calendar_days',
    clock_start: 'date the suspension begins',
    quote:
      'If, under the provisions of paragraphs (a)(2) through (a)(4) of this section, a suspension of payment is put into effect without prior notice to the provider or supplier, the Medicare contractor must, once the suspension is in effect, give the provider or supplier an opportunity to submit a rebuttal statement as to why the suspension should be removed. ... Except as provided in paragraphs (d)(2) and (d)(3) of this section, a suspension of payment is limited to 180 days, starting with the date the suspension begins.',
    source_url: 'https://www.ecfr.gov/current/title-42/part-405/section-405.372',
    checked_date: READ_DATE,
  },
  {
    section: '42 CFR 405.374(a)-(b)',
    title: 'Opportunity for rebuttal — At least 15 days following the date of notification',
    day_count: 15,
    day_type: 'calendar_days',
    clock_start: 'date of notification (unless shortened or extended for cause under § 405.374(b) or stated otherwise on the notice)',
    quote:
      'If prior notice of the suspension of payment, offset, or recoupment is given under § 405.372 or § 405.373, the Medicare contractor must give the provider or supplier an opportunity, before the suspension, offset, or recoupment takes effect, to submit any statement (to include any pertinent information) as to why it should not be put into effect on the date specified in the notice. Except as provided in paragraph (b) of this section, the provider or supplier has at least 15 days following the date of notification to submit the statement. (b) Exception. The Medicare contractor may for cause— (1) Impose a shorter period for rebuttal; or (2) Extend the time within which the statement must be submitted.',
    source_url: 'https://www.ecfr.gov/current/title-42/part-405/section-405.374',
    checked_date: READ_DATE,
  },
  {
    section: '42 CFR 405.375(a)-(c)',
    title: 'Time limits for administrative determination (15 days from receipt) and non-appealability',
    day_count: 15,
    day_type: 'calendar_days',
    clock_start: 'date the rebuttal statement is received by CMS or the Medicare contractor',
    quote:
      'If the provider or supplier submits a statement, under § 405.374, as to why a suspension of payment, offset, or recoupment should not be put into effect, or, under § 405.372(b)(2), why a suspension should be terminated, CMS, the intermediary, or carrier must within 15 days, from the date the statement is received, consider the statement (including any pertinent evidence submitted), together with any other material bearing upon the case, and determine whether the facts justify the suspension, offset, or recoupment or, if already initiated, justify the termination of the suspension, offset, or recoupment. Suspension, offset, or recoupment is not delayed beyond the date stated in the notice in order to review the statement. ... (c) Determination is not appealable. A determination made under paragraph (a) of this section is not an initial determination and is not appealable.',
    source_url: 'https://www.ecfr.gov/current/title-42/part-405/section-405.375',
    checked_date: READ_DATE,
  },
  {
    section: '42 CFR 401.305(b)',
    title: 'Requirements for reporting and returning of overpayments — 60-day deadline and 180-day good-faith investigation cap',
    day_count: 60,
    day_type: 'calendar_days',
    clock_start: 'date on which the overpayment was identified (suspended up to 180 days during a timely, good-faith investigation of related overpayments under § 401.305(b)(3))',
    quote:
      'Except as provided in paragraphs (b)(2) and (3) of this section, a person who has received an overpayment must report and return the overpayment by the later of either of the following: (i) The date which is 60 days after the date on which the overpayment was identified.',
    source_url: 'https://www.ecfr.gov/current/title-42/part-401/section-401.305',
    checked_date: READ_DATE,
  },
];

export const REBUTTAL_OUTLINE = {
  counsel_warning:
    'Talk to a healthcare regulatory lawyer before sending a rebuttal statement. Under 42 CFR 405.371(a)(2) and 405.372(a)(4), a suspension based on a credible allegation of fraud is imposed by CMS in consultation with HHS-OIG and, as appropriate, the Department of Justice — anything you put in writing can be shared with OIG and DOJ investigators.',
  sections: [
    {
      heading: '1. Identify the notice, the regulatory basis cited, and whether prior notice was given or withheld',
      citation: '42 CFR 405.371(a) & 405.372(a)-(b)',
      source_url: 'https://www.ecfr.gov/current/title-42/part-405/section-405.372',
      rule_quote:
        'If prior notice of the suspension of payment, offset, or recoupment is given under § 405.372 or § 405.373, the Medicare contractor must give the provider or supplier an opportunity, before the suspension, offset, or recoupment takes effect, to submit any statement (to include any pertinent information) as to why it should not be put into effect on the date specified in the notice. ... If, under the provisions of paragraphs (a)(2) through (a)(4) of this section, a suspension of payment is put into effect without prior notice to the provider or supplier, the Medicare contractor must, once the suspension is in effect, give the provider or supplier an opportunity to submit a rebuttal statement as to why the suspension should be removed.',
      what_to_address:
        'State the date on the notice letter, the NPI(s)/PTAN(s) and claim lines or service dates named, whether the notice cites reliable information of an overpayment (§ 405.371(a)(1)) or a credible allegation of fraud (§ 405.371(a)(2)), and confirm the exact submission deadline printed on the notice.',
    },
    {
      heading: '2. Submit pertinent factual and medical-record evidence addressing the specific reasons in the notice',
      citation: '42 CFR 405.374(a) & 405.375(a)-(b)',
      source_url: 'https://www.ecfr.gov/current/title-42/part-405/section-405.374',
      rule_quote:
        'CMS, the intermediary, or carrier must within 15 days, from the date the statement is received, consider the statement (including any pertinent evidence submitted), together with any other material bearing upon the case, and determine whether the facts justify the suspension, offset, or recoupment or, if already initiated, justify the termination of the suspension, offset, or recoupment. ... The notice must ... (2) In the case of suspension of payment, contain specific findings on the conditions upon which the suspension is initiated, continued, or removed and an explanatory statement of the determination.',
      what_to_address:
        'Respond fact-by-fact to the specific findings or claim samples cited in the notice (for example: signed orders, prior-visit dates, patient consent entries, device transmission logs, or separately identifiable visit notes), and request specific written findings under § 405.375(b)(2).',
    },
    {
      heading: '3. Request a partial suspension (code-specific or percentage) or a good-cause exception where supported by the record',
      citation: '42 CFR 405.371(a) & 405.371(b)(1)',
      source_url: 'https://www.ecfr.gov/current/title-42/part-405/section-405.371',
      rule_quote:
        'Medicare payments to providers and suppliers ... may be ... Suspended, in whole or in part, by CMS or a Medicare contractor ... CMS may find that good cause exists not to suspend payments or not to continue to suspend payments to an individual or entity against which there are credible allegations of fraud if— ... (ii) It is determined that beneficiary access to items or services would be so jeopardized by a payment suspension in whole or part as to cause a danger to life or health; (iii) It is determined that other available remedies implemented by CMS or a Medicare contractor more effectively or quickly protect Medicare funds than would implementing a payment suspension; or (iv) CMS determines that a payment suspension or a continuation of a payment suspension is not in the best interests of the Medicare program.',
      what_to_address:
        'Because § 405.371(a) authorizes suspension "in whole or in part," ask CMS and the contractor to narrow any suspension to the specific service lines or practitioners under review rather than freezing unrelated care, and present any applicable good-cause facts under § 405.371(b)(1)(ii)–(iv) (such as patient access impact in the community or narrower protective remedies).',
    },
    {
      heading: '4. Preserve the timeline record (180-day cap under § 405.372(d) and 180-day good-cause review under § 405.371(b)(2))',
      citation: '42 CFR 405.372(d)(1)-(3) & 405.371(b)(2)-(3)',
      source_url: 'https://www.ecfr.gov/current/title-42/part-405/section-405.372',
      rule_quote:
        'Except as provided in paragraphs (d)(2) and (d)(3) of this section, a suspension of payment is limited to 180 days, starting with the date the suspension begins. ... Every 180 days after the initiation of a suspension of payments based on credible allegations of fraud, CMS will— (i) Evaluate whether there is good cause to not continue such suspension under this section; and (ii) Request a certification from the OIG or other law enforcement agency that the matter continues to be under investigation warranting continuation of the suspension.',
      what_to_address:
        'Record the delivery proof (date CMS or the contractor received the rebuttal) so the 15-day determination window under § 405.375(a) and the 180-day duration/review clocks under § 405.372(d) and § 405.371(b)(2) are documented from day one.',
    },
  ],
};

/**
 * Compute Medicare payment suspension deadlines from a notice date (YYYY-MM-DD)
 * and optional rebuttal receipt date (YYYY-MM-DD).
 *
 * @param {string | { notice?: string, rebuttal_received?: string, rebuttalReceived?: string }} input
 */
export function computeSuspensionDeadlines(input) {
  const opts = typeof input === 'string' ? { notice: input } : (input || {});
  const rawNotice = opts.notice !== undefined ? String(opts.notice).trim() : '';
  if (!rawNotice) {
    return {
      ok: false,
      error: 'invalid_query',
      detail: 'Missing required query parameter: notice=YYYY-MM-DD (the date on the suspension notice).',
    };
  }
  const noticeDt = parseIsoDateUtc(rawNotice);
  if (!noticeDt) {
    return {
      ok: false,
      error: 'invalid_query',
      detail: `Invalid notice date "${rawNotice}". Provide a valid calendar date in YYYY-MM-DD format (between 1996-01-01 and 2100-12-31).`,
    };
  }
  const noticeDate = formatIsoDateUtc(noticeDt);

  const rawReceived =
    opts.rebuttal_received !== undefined
      ? String(opts.rebuttal_received).trim()
      : opts.rebuttalReceived !== undefined
      ? String(opts.rebuttalReceived).trim()
      : '';

  let receivedDate = null;
  if (rawReceived) {
    const recDt = parseIsoDateUtc(rawReceived);
    if (!recDt) {
      return {
        ok: false,
        error: 'invalid_query',
        detail: `Invalid rebuttal_received date "${rawReceived}". Provide a valid calendar date in YYYY-MM-DD format.`,
      };
    }
    if (recDt.getTime() < noticeDt.getTime()) {
      return {
        ok: false,
        error: 'invalid_query',
        detail: `rebuttal_received (${rawReceived}) cannot be earlier than notice (${noticeDate}).`,
      };
    }
    receivedDate = formatIsoDateUtc(recDt);
  }

  // 42 CFR 405.374(a): "at least 15 days following the date of notification to submit the statement"
  const rebuttalDue = addCalendarDays(noticeDate, 15);
  const rebuttalDow = dayOfWeekUtc(rebuttalDue);
  const recommendedDeliveryBy = precedingBusinessDayIfWeekend(rebuttalDue);

  // 42 CFR 405.375(a): "within 15 days, from the date the statement is received"
  const effectiveReceiptDate = receivedDate || rebuttalDue;
  const cmsDeterminationDue = addCalendarDays(effectiveReceiptDate, 15);
  const cmsDeterminationDow = dayOfWeekUtc(cmsDeterminationDue);
  const cmsDeterminationIfReceivedSameDay = addCalendarDays(noticeDate, 15);
  const cmsDeterminationIfReceivedOnDay15 = addCalendarDays(rebuttalDue, 15);

  // 42 CFR 405.372(d)(1): "limited to 180 days, starting with the date the suspension begins"
  const initial180DayLimitEnd = addCalendarDays(noticeDate, 180);

  const rawOverpayment =
    opts.overpayment_identified !== undefined
      ? String(opts.overpayment_identified).trim()
      : opts.overpaymentIdentified !== undefined
      ? String(opts.overpaymentIdentified).trim()
      : '';

  let overpaymentClock = null;
  if (rawOverpayment) {
    const ovRes = computeOverpaymentDeadlines({
      identified: rawOverpayment,
      investigation_concluded: opts.investigation_concluded ?? opts.investigationConcluded,
    });
    if (!ovRes.ok) return ovRes;
    overpaymentClock = ovRes;
  }

  const out = {
    ok: true,
    notice_date: noticeDate,
    notice_day_of_week: dayOfWeekUtc(noticeDate).name,
    day_count_basis:
      'Calendar days ("15 days" in 42 CFR 405.374(a) and 42 CFR 405.375(a); neither section excludes weekends or holidays).',
    rebuttal: {
      due_date: rebuttalDue,
      due_day_of_week: rebuttalDow.name,
      falls_on_weekend: rebuttalDow.is_weekend,
      recommended_delivery_by: recommendedDeliveryBy,
      days_from_notice: 15,
      clock_start: 'Date of notification (42 CFR 405.374(a)), unless the contractor imposes a shorter period or extends the time for cause under 42 CFR 405.374(b). Always check the specific date printed on the notice letter.',
      citation: '42 CFR 405.374(a)-(b)',
      source_url: 'https://www.ecfr.gov/current/title-42/part-405/section-405.374',
    },
    cms_determination: {
      assumed_rebuttal_received_date: effectiveReceiptDate,
      rebuttal_received_supplied: Boolean(receivedDate),
      due_date: cmsDeterminationDue,
      due_day_of_week: cmsDeterminationDow.name,
      earliest_if_received_on_notice_date: cmsDeterminationIfReceivedSameDay,
      latest_if_received_on_day_15: cmsDeterminationIfReceivedOnDay15,
      days_from_receipt: 15,
      clock_start: 'Date the rebuttal statement is received by CMS, the intermediary, or carrier (42 CFR 405.375(a)). Submitting the rebuttal does not delay the suspension beyond the effective date stated in the notice.',
      appealable: false,
      non_appealable_note: 'A determination under 42 CFR 405.375(a) is not an initial determination and is not appealable (42 CFR 405.375(c)).',
      citation: '42 CFR 405.375(a)-(c)',
      source_url: 'https://www.ecfr.gov/current/title-42/part-405/section-405.375',
    },
    duration_and_partial_relief: {
      initial_180_day_limit_end: initial180DayLimitEnd,
      duration_note:
        'Under 42 CFR 405.372(d)(1), a non-fraud suspension is limited to 180 days starting with the date the suspension begins (with one possible 180-day extension under § 405.372(d)(2)). For credible allegations of fraud (§ 405.371(a)(2)), the 180-day limit does not apply (§ 405.372(d)(3)), and CMS evaluates good cause and requests OIG/law-enforcement certification every 180 days (§ 405.371(b)(2)).',
      partial_suspension_allowed: true,
      partial_suspension_note:
        'Under 42 CFR 405.371(a), payments may be suspended "in whole or in part," and under 42 CFR 405.371(b)(1)(i)-(iv) CMS may find good cause not to suspend (or not to continue to suspend) payments in whole or in part — including where beneficiary access would be so jeopardized as to cause a danger to life or health (§ 405.371(b)(1)(ii)) or where other remedies more effectively or quickly protect Medicare funds (§ 405.371(b)(1)(iii)).',
      citation: '42 CFR 405.371(a)-(b) & 405.372(d)',
      source_url: 'https://www.ecfr.gov/current/title-42/part-405/section-405.371',
    },
    rules: REGULATORY_RULES,
    rebuttal_outline: REBUTTAL_OUTLINE,
  };

  if (overpaymentClock) {
    out.overpayment_60_day_clock = overpaymentClock;
  }

  return out;
}

/**
 * Compute Medicare 60-day overpayment report-and-return deadline and 180-day
 * good-faith investigation cap under 42 CFR 401.305(b)(1)-(3).
 *
 * @param {string | { identified?: string, investigation_concluded?: string, investigationConcluded?: string }} input
 */
export function computeOverpaymentDeadlines(input) {
  const opts = typeof input === 'string' ? { identified: input } : (input || {});
  const rawId = opts.identified !== undefined ? String(opts.identified).trim() : '';
  if (!rawId) {
    return {
      ok: false,
      error: 'invalid_query',
      detail: 'Missing required parameter: identified=YYYY-MM-DD (the date on which the overpayment was identified under 42 CFR 401.305(b)(1)).',
    };
  }
  const idDt = parseIsoDateUtc(rawId);
  if (!idDt) {
    return {
      ok: false,
      error: 'invalid_query',
      detail: `Invalid identified date "${rawId}". Provide a valid calendar date in YYYY-MM-DD format (between 1996-01-01 and 2100-12-31).`,
    };
  }
  const identifiedDate = formatIsoDateUtc(idDt);

  const rawConcluded =
    opts.investigation_concluded !== undefined
      ? String(opts.investigation_concluded).trim()
      : opts.investigationConcluded !== undefined
      ? String(opts.investigationConcluded).trim()
      : '';

  let concludedDate = null;
  if (rawConcluded) {
    const concDt = parseIsoDateUtc(rawConcluded);
    if (!concDt) {
      return {
        ok: false,
        error: 'invalid_query',
        detail: `Invalid investigation_concluded date "${rawConcluded}". Provide a valid calendar date in YYYY-MM-DD format.`,
      };
    }
    if (concDt.getTime() < idDt.getTime()) {
      return {
        ok: false,
        error: 'invalid_query',
        detail: `investigation_concluded (${rawConcluded}) cannot be earlier than identified (${identifiedDate}).`,
      };
    }
    concludedDate = formatIsoDateUtc(concDt);
  }

  const standard60DayDue = addCalendarDays(identifiedDate, 60);
  const standard60Dow = dayOfWeekUtc(standard60DayDue);
  const investigation180Cap = addCalendarDays(identifiedDate, 180);
  const investigation180Dow = dayOfWeekUtc(investigation180Cap);

  // Under 42 CFR 401.305(b)(3)(i)-(ii), the deadline is suspended until the earlier of
  // the date the good-faith investigation concludes and the aggregate amount is calculated,
  // or day 180 after initial identification.
  const effectiveInvestigationDue =
    concludedDate && concludedDate < investigation180Cap
      ? concludedDate
      : investigation180Cap;
  const effectiveInvestigationDow = dayOfWeekUtc(effectiveInvestigationDue);

  return {
    ok: true,
    identified_date: identifiedDate,
    identified_day_of_week: dayOfWeekUtc(identifiedDate).name,
    standard_60_day_due_date: standard60DayDue,
    standard_60_day_day_of_week: standard60Dow.name,
    standard_60_day_recommended_delivery_by: precedingBusinessDayIfWeekend(standard60DayDue),
    good_faith_investigation_180_day_cap: investigation180Cap,
    good_faith_investigation_180_day_of_week: investigation180Dow.name,
    investigation_concluded_date: concludedDate,
    effective_suspended_due_date: effectiveInvestigationDue,
    effective_suspended_day_of_week: effectiveInvestigationDow.name,
    quote:
      'Except as provided in paragraphs (b)(2) and (3) of this section, a person who has received an overpayment must report and return the overpayment by the later of either of the following: (i) The date which is 60 days after the date on which the overpayment was identified. ... If the person has identified an overpayment but has not yet completed a good-faith investigation to determine the existence of related overpayments that may arise from the same or similar cause or reason as the initially identified overpayment, the deadline in paragraph (b)(1)(i) of this section ... is suspended until the earlier of either of the following: (i) The date that the investigation of related overpayments has concluded and the aggregate amount of the initially identified overpayment and related overpayments is calculated. (ii) The date that is 180 days after the date on which the initial identified overpayment was identified.',
    citation: '42 CFR 401.305(b)(1), (b)(3)(i)-(ii)',
    source_url: 'https://www.ecfr.gov/current/title-42/part-401/section-401.305',
    checked_date: READ_DATE,
  };
}

