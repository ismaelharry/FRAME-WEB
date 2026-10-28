import { z } from 'zod';
import { AppError } from './util.js';

export { z };

const trim = (max) => z.string().trim().max(max);
export const V = {
  name: trim(120).min(2),
  email: z.string().trim().toLowerCase().max(160).pipe(z.email()),
  phone: trim(40).regex(/^[+()0-9\s.-]{6,40}$/).optional().or(z.literal('')),
  optText: (max) => trim(max).optional().or(z.literal('')),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  lang: z.enum(['es', 'en']).default('es'),
  bool: z.preprocess((v) => v === true || v === 'true' || v === 'on' || v === '1' || v === 1, z.boolean()),
  int: (min, max) => z.coerce.number().int().min(min).max(max),
};

export function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const fields = {};
    for (const issue of r.error.issues) fields[issue.path.join('.') || '_'] = issue.code;
    throw new AppError('VALIDATION', 400, { fields });
  }
  return r.data;
}
