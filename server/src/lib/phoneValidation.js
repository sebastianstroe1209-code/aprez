// SPEC §3.1 — Romanian diner/guest phone format: "+40" followed by 9
// digits. Enforced on every write path where a diner or guest phone
// string lands in the DB (registration, diner profile update,
// staff-created reservation, staff reservation edit). Reads are never
// re-validated — legacy rows predating this rule are left untouched.
//
// Restaurant-entity phone numbers (admin restaurant onboarding, the
// restaurant's own Manage-Profile contact field) are deliberately NOT
// covered: §3.1 governs diner phone, and a venue's contact line may be
// a landline with a different shape. Tightening those is a separate call.
const ROMANIAN_PHONE_RE = /^\+40\d{9}$/;

// The single canonical message string. `phoneFormatErrorBody` matches on
// it to tell a format failure apart from other validation errors on the
// same field (e.g. a missing required guestPhone), so every `.matches()`
// validator below MUST attach exactly this message via `.withMessage()`.
const PHONE_FORMAT_MSG = 'Phone must be in +40XXXXXXXXX format';

// Given an express-validator errors array, return the structured 400
// body the Tier E/F error contract expects ({ error: { code, message } })
// when a phone-format failure is present; otherwise null so the caller
// falls through to its generic validation-error response.
function phoneFormatErrorBody(errorsArray) {
  const hit = errorsArray.find((e) => e.msg === PHONE_FORMAT_MSG);
  if (!hit) return null;
  return { error: { code: 'invalid-phone-format', message: PHONE_FORMAT_MSG } };
}

module.exports = { ROMANIAN_PHONE_RE, PHONE_FORMAT_MSG, phoneFormatErrorBody };
