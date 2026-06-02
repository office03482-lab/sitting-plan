const BATCH_KEYWORDS = [
  'med',
  'medical',
  'non med',
  'non medical',
  'newton',
  'aiims',
  'neet',
  'jee',
  'advance',
  'adv',
  'ssb',
  'sure selection',
  'dropper',
  'pcm',
  'pcb',
  'batch',
];

const safeText = (value: unknown) => (value == null ? '' : String(value).trim());

export const looksLikeAcademicBatchName = (value: unknown) => {
  const normalized = safeText(value).toLowerCase();
  if (!normalized) return false;
  return BATCH_KEYWORDS.some((keyword) => normalized.includes(keyword));
};

export const getSafeStudentClassName = (student: { class_name?: unknown; batch?: unknown }) => {
  const className = safeText(student.class_name);
  if (!className) return '';
  return className;
};
