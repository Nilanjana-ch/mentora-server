import { z } from 'zod';

// ---------- sanitise: "$" diye shuru ba "." thaka key fele dey ----------
const clean = (obj) => {
  if (Array.isArray(obj)) return obj.map(clean);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('$') || k.includes('.')) continue;
      out[k] = clean(v);
    }
    return out;
  }
  return obj;
};

export const sanitize = (req, res, next) => {
  if (req.body) req.body = clean(req.body);
  next();
};

// ---------- validate(schema): body check, thik na hole 400 ----------
export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input.',
        details: result.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      },
    });
  }
  req.body = result.data; // shudhu valid + allowed field thake
  next();
};

// ---------- schemas ----------
const str = (max) => z.string().trim().max(max);
const list = z.array(str(60)).max(30);

const postShape = {
  title: str(150).min(3),
  description: str(5000).min(5),
  category: z.enum(['full-time', 'internship', 'project', 'research-lab']),
  organization: str(150),
  skills: list,
  eligibleDepartments: z.union([list, str(200)]),
  minCGPA: z.coerce.number().min(0).max(4),
  deadline: str(40),
  workMode: str(40),
  location: str(150),
  externalLink: z.union([z.literal(''), z.string().trim().url().max(500)]),
  coverImage: z.union([z.literal(''), z.string().trim().url().max(500)]),
};

export const createPostSchema = z.object({
  ...postShape,
}).partial().required({ title: true, description: true });

export const updatePostSchema = z
  .object(postShape)
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update.' });

export const profileSchema = z
  .object({
    name: str(100).min(1),
    studentId: str(50),
    batch: str(50),
    department: str(100),
    cgpa: z.coerce.number().min(0).max(4),
    resumeLink: z.union([z.literal(''), z.string().trim().url().max(500)]),
    skills: z.union([list, str(500)]),
    company: str(150),
    designation: str(150),
    interestedFields: z.union([list, str(500)]),
  })
  .partial();

export const createRequestSchema = z.object({
  postId: z.string().length(24).optional(),
  recipientEmail: z.string().trim().email().max(200).optional(),
  message: str(2000).optional(),
});

export const requestStatusSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
});