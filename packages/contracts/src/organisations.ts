import { z } from 'zod';
import { emailSchema, tenantKindSchema, tenantStatusSchema } from './auth.js';

/** Phase 4: organisation applications, platform review, invitations, members, roles, departments. */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

/** Kenyan KRA PIN: letter, 9 digits, letter (e.g. P051234567X). */
export const kraPinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]\d{9}[A-Z]$/, { error: 'A KRA PIN looks like P051234567X' });

/** E.164 phone number, e.g. +254712345678. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, { error: 'Use international format, e.g. +254712345678' });

export const EMPLOYEE_BANDS = ['1-10', '11-50', '51-200', '201-1000', '1000+'] as const;

/** Every field the applicant can edit. All optional on update; `submit` checks completeness. */
export const organisationProfileInputSchema = z.object({
  legalName: z.string().trim().min(2).max(200).optional(),
  tradingName: optionalText(200),
  registrationNumber: optionalText(50),
  registrationNumberAbsentWhy: optionalText(300),
  kraPin: kraPinSchema.nullable().optional(),
  kraPinAbsentWhy: optionalText(300),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  region: optionalText(100),
  address: optionalText(300),
  phone: phoneSchema.nullable().optional(),
  contactEmail: emailSchema.nullable().optional(),
  industry: optionalText(100),
  employeeBand: z.enum(EMPLOYEE_BANDS).nullable().optional(),
});

export const registerOrganisationRequestSchema = organisationProfileInputSchema.extend({
  legalName: z.string().trim().min(2).max(200),
});

export type OrganisationProfileInput = z.infer<typeof organisationProfileInputSchema>;
export type RegisterOrganisationRequest = z.infer<typeof registerOrganisationRequestSchema>;

export const applicationStatusSchema = z.enum([
  'DRAFT',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
]);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

export const organisationProfileSchema = z.object({
  legalName: z.string(),
  tradingName: z.string().nullable(),
  registrationNumber: z.string().nullable(),
  registrationNumberAbsentWhy: z.string().nullable(),
  kraPin: z.string().nullable(),
  kraPinAbsentWhy: z.string().nullable(),
  country: z.string(),
  region: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  industry: z.string().nullable(),
  employeeBand: z.string().nullable(),
});

export const fileSummarySchema = z.object({
  id: z.uuid(),
  purpose: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  status: z.enum(['QUARANTINED', 'CLEAN', 'REJECTED']),
  createdAt: z.iso.datetime(),
});

export const applicationEventSchema = z.object({
  fromStatus: applicationStatusSchema.nullable(),
  toStatus: applicationStatusSchema,
  reason: z.string().nullable(),
  occurredAt: z.iso.datetime(),
});

export const organisationApplicationResponseSchema = z.object({
  applicationId: z.uuid(),
  tenantId: z.uuid(),
  tenantStatus: tenantStatusSchema,
  status: applicationStatusSchema,
  decisionReason: z.string().nullable(),
  submittedAt: z.iso.datetime().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  /** Fields still needed before the application can be submitted. */
  missing: z.array(z.string()),
  profile: organisationProfileSchema,
  documents: z.array(fileSummarySchema),
  history: z.array(applicationEventSchema),
});

export const registerOrganisationResponseSchema = z.object({
  tenantId: z.uuid(),
  applicationId: z.uuid(),
});

export type OrganisationProfile = z.infer<typeof organisationProfileSchema>;
export type FileSummary = z.infer<typeof fileSummarySchema>;
export type OrganisationApplicationResponse = z.infer<typeof organisationApplicationResponseSchema>;
export type RegisterOrganisationResponse = z.infer<typeof registerOrganisationResponseSchema>;

// ---------------------------------------------------------------- platform review

export const decisionReasonSchema = z.string().trim().min(10).max(1000);
export const approveRequestSchema = z.object({ note: z.string().trim().max(1000).optional() });
export const reasonRequestSchema = z.object({ reason: decisionReasonSchema });

export const applicationQueueItemSchema = z.object({
  applicationId: z.uuid(),
  tenantId: z.uuid(),
  legalName: z.string(),
  status: applicationStatusSchema,
  submittedAt: z.iso.datetime().nullable(),
  applicantEmail: z.string(),
});
export const applicationQueueResponseSchema = z.object({
  applications: z.array(applicationQueueItemSchema),
});
export const platformApplicationResponseSchema = organisationApplicationResponseSchema.extend({
  applicantEmail: z.string(),
  documents: z.array(fileSummarySchema.extend({ downloadUrl: z.string().nullable() })),
});

export type ApplicationQueueResponse = z.infer<typeof applicationQueueResponseSchema>;
export type PlatformApplicationResponse = z.infer<typeof platformApplicationResponseSchema>;

// ---------------------------------------------------------------- invitations

export const createInvitationRequestSchema = z.object({
  email: emailSchema,
  roleIds: z.array(z.uuid()).min(1).max(10),
  departmentId: z.uuid().nullable().optional(),
});
export const acceptInvitationRequestSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, { error: 'Invalid invitation' }),
});

export const invitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  roles: z.array(z.string()),
  status: z.enum(['PENDING', 'ACCEPTED', 'REVOKED']),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export const invitationListResponseSchema = z.object({ invitations: z.array(invitationSchema) });
export const acceptInvitationResponseSchema = z.object({
  tenantId: z.uuid(),
  tenantName: z.string(),
  kind: tenantKindSchema,
});

export type Invitation = z.infer<typeof invitationSchema>;
export type InvitationListResponse = z.infer<typeof invitationListResponseSchema>;
export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponseSchema>;

// ---------------------------------------------------------------- members, roles, departments

export const updateMemberRequestSchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED', 'ENDED']).optional(),
    departmentId: z.uuid().nullable().optional(),
  })
  .refine((value) => value.status !== undefined || value.departmentId !== undefined, {
    error: 'Nothing to change',
  });
export const setMemberRolesRequestSchema = z.object({ roleIds: z.array(z.uuid()).min(1).max(10) });

export const roleSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  permissions: z.array(z.string()),
});
export const roleListResponseSchema = z.object({ roles: z.array(roleSchema) });
export const permissionListResponseSchema = z.object({
  permissions: z.array(z.object({ code: z.string(), description: z.string() })),
});
export const createRoleRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{2,49}$/, { error: 'Lower-case letters, digits and _ only' }),
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(300).nullable().optional(),
  permissions: z.array(z.string()).min(1).max(100),
});
export const updateRoleRequestSchema = createRoleRequestSchema
  .omit({ code: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: 'Nothing to change' });

export const departmentSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  archived: z.boolean(),
  memberCount: z.number().int(),
});
export const departmentListResponseSchema = z.object({ departments: z.array(departmentSchema) });
export const createDepartmentRequestSchema = z.object({ name: z.string().trim().min(1).max(100) });
export const updateDepartmentRequestSchema = z
  .object({ name: z.string().trim().min(1).max(100).optional(), archived: z.boolean().optional() })
  .refine((value) => value.name !== undefined || value.archived !== undefined, {
    error: 'Nothing to change',
  });

export type Role = z.infer<typeof roleSchema>;
export type RoleListResponse = z.infer<typeof roleListResponseSchema>;
export type PermissionListResponse = z.infer<typeof permissionListResponseSchema>;
export type Department = z.infer<typeof departmentSchema>;
export type DepartmentListResponse = z.infer<typeof departmentListResponseSchema>;

// ---------------------------------------------------------------- files

export const FILE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const fileUploadResponseSchema = z.object({
  id: z.uuid(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  status: z.literal('QUARANTINED'),
});
export const fileDownloadResponseSchema = z.object({
  url: z.string(),
  expiresInSeconds: z.number().int(),
});
export type FileUploadResponse = z.infer<typeof fileUploadResponseSchema>;
export type FileDownloadResponse = z.infer<typeof fileDownloadResponseSchema>;
