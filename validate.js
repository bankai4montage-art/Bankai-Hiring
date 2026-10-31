/**
 * Shared record rules for couriers.
 *
 * Used by the REST endpoints (create / update) and by the bulk importer, so a
 * row coming from an Excel sheet is held to exactly the same standard as one
 * typed in the form.
 */

export const STATUSES = [
  'Active', 'Inactive', 'Attended to D0', 'Not Attended to D0', 'OnBoarding', 'OffBoarding'
];
export const BRANCHES = ['QCD1', 'QCD2'];
export const EMPLOYMENT_TYPES = ['Full Time', 'Part Time'];

/** Server-side validation (mirrors the client-side rules). */
export function validate(data) {
  const e = {};
  if (!data.fullName || data.fullName.trim().length < 3) e.fullName = 'Full name is required (min 3 chars).';
  if (!data.phone || !/^01[0125][0-9]{8}$/.test(String(data.phone || '').trim())) e.phone = 'Phone must be a valid Egyptian mobile (11 digits).';
  if (!data.nationalId || !/^\d{14}$/.test(String(data.nationalId || '').trim())) e.nationalId = 'National ID must be exactly 14 digits.';
  if (!BRANCHES.includes(data.branch)) e.branch = 'Branch must be QCD1 or QCD2.';
  if (!EMPLOYMENT_TYPES.includes(data.employmentType)) e.type = 'Employment type must be Full Time or Part Time.';
  if (!data.licenseStart) e.licenseStart = 'License start date is required.';
  if (!data.licenseEnd || (data.licenseStart && String(data.licenseEnd) < String(data.licenseStart))) e.licenseEnd = 'End date is required and must be after the start date.';
  if (data.outlook && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.outlook).trim())) e.outlook = 'Outlook account must be a valid email.';
  if (!STATUSES.includes(data.status)) e.status = 'Invalid courier status.';
  return e;
}

/** Trim every incoming string and drop unknown keys. */
export function parseRecord(body) {
  return {
    fullName: String(body.fullName ?? '').trim(),
    phone: String(body.phone ?? '').trim(),
    nationalId: String(body.nationalId ?? '').trim(),
    branch: String(body.branch ?? ''),
    employmentType: String(body.employmentType ?? ''),
    licenseStart: String(body.licenseStart ?? '').trim(),
    licenseEnd: String(body.licenseEnd ?? '').trim(),
    outlook: String(body.outlook ?? '').trim(),
    plate: String(body.plate ?? '').trim(),
    status: String(body.status ?? '')
  };
}
