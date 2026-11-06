import { z } from 'zod';
import { phoneSchema } from './organisations.js';
import {
  applicationStatusSchema,
  applicationEventSchema,
  fileSummarySchema,
} from './organisations.js';

/** Phase 5: providers (companies and individuals), skills, coverage, availability, eligibility. */

export const providerKindSchema = z.enum(['COMPANY', 'INDIVIDUAL']);
export const providerStatusSchema = z.enum(['PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'SUSPENDED']);
export const experienceBandSchema = z.enum([
  'UNDER_1_YEAR',
  'YEARS_1_3',
  'YEARS_3_5',
  'OVER_5_YEARS',
]);
export const skillCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{1,59}$/);
export const regionCodeSchema = z.string().regex(/^[A-Z]{2}-[0-9A-Z]{1,3}$/);
/** "HH:MM", 00:00–24:00. */
export const clockTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, { error: 'Use HH:MM' });

export const registerProviderCompanyRequestSchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  tradingName: z.string().trim().min(2).max(200).optional(),
});
export const applyIndividualProviderRequestSchema = z.object({
  displayName: z.string().trim().min(2).max(200),
  phone: phoneSchema.optional(),
  homeRegion: regionCodeSchema.optional(),
});
export const updateProviderProfileRequestSchema = z
  .object({
    displayName: z.string().trim().min(2).max(200),
    phone: phoneSchema.nullable(),
    homeRegion: regionCodeSchema.nullable(),
    remoteOk: z.boolean(),
    acceptingWork: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: 'Nothing to change' });

export const setProviderSkillsRequestSchema = z.object({
  skills: z
    .array(z.object({ code: skillCodeSchema, experience: experienceBandSchema }))
    .max(50)
    .refine((items) => new Set(items.map((item) => item.code)).size === items.length, {
      error: 'Each skill once',
    }),
});
export const setProviderRegionsRequestSchema = z.object({
  regionCodes: z
    .array(regionCodeSchema)
    .max(100)
    .refine((codes) => new Set(codes).size === codes.length, { error: 'Each region once' }),
});
export const workingHoursEntrySchema = z
  .object({ weekday: z.number().int().min(1).max(7), start: clockTimeSchema, end: clockTimeSchema })
  .refine((entry) => entry.start < entry.end, { error: 'End must be after start', path: ['end'] });
export const setWorkingHoursRequestSchema = z.object({
  hours: z.array(workingHoursEntrySchema).max(21),
});
export const createTimeOffRequestSchema = z
  .object({
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    error: 'End must be after start',
    path: ['endsAt'],
  });

export const providerSkillSchema = z.object({
  code: z.string(),
  name: z.string(),
  experience: experienceBandSchema,
});
export const providerResponseSchema = z.object({
  providerId: z.uuid(),
  kind: providerKindSchema,
  displayName: z.string(),
  status: providerStatusSchema,
  phone: z.string().nullable(),
  homeRegion: z.string().nullable(),
  remoteOk: z.boolean(),
  acceptingWork: z.boolean(),
  application: z.object({
    applicationId: z.uuid(),
    status: applicationStatusSchema,
    decisionReason: z.string().nullable(),
    submittedAt: z.iso.datetime().nullable(),
    missing: z.array(z.string()),
    history: z.array(applicationEventSchema),
  }),
  skills: z.array(providerSkillSchema),
  regions: z.array(z.object({ code: z.string(), name: z.string() })),
  workingHours: z.array(
    z.object({ weekday: z.number().int(), start: z.string(), end: z.string() }),
  ),
  timeOff: z.array(
    z.object({
      id: z.uuid(),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
      reason: z.string().nullable(),
    }),
  ),
  documents: z.array(fileSummarySchema),
  /** Business details of a provider company (null for individuals). */
  business: z
    .object({
      legalName: z.string(),
      registrationNumber: z.string().nullable(),
      registrationNumberAbsentWhy: z.string().nullable(),
      kraPin: z.string().nullable(),
      kraPinAbsentWhy: z.string().nullable(),
    })
    .nullable(),
});
export type ProviderResponse = z.infer<typeof providerResponseSchema>;

export const skillListResponseSchema = z.object({
  skills: z.array(
    z.object({ code: z.string(), name: z.string(), category: z.string(), active: z.boolean() }),
  ),
});
export const regionListResponseSchema = z.object({
  regions: z.array(z.object({ code: z.string(), name: z.string(), country: z.string() })),
});
export type SkillListResponse = z.infer<typeof skillListResponseSchema>;
export type RegionListResponse = z.infer<typeof regionListResponseSchema>;

// ---------------------------------------------------------------- staff

export const verificationChecklistSchema = z.object({
  identityChecked: z.boolean(),
  registrationChecked: z.boolean(),
  taxChecked: z.boolean(),
  skillsChecked: z.boolean(),
  notes: z.string().trim().max(1000).optional(),
});
export const approveProviderRequestSchema = z.object({ checklist: verificationChecklistSchema });
export type VerificationChecklist = z.infer<typeof verificationChecklistSchema>;

export const platformProviderApplicationResponseSchema = providerResponseSchema.extend({
  applicantEmail: z.string(),
  documents: z.array(fileSummarySchema.extend({ downloadUrl: z.string().nullable() })),
  verification: verificationChecklistSchema.nullable(),
});
export type PlatformProviderApplicationResponse = z.infer<
  typeof platformProviderApplicationResponseSchema
>;

export const eligibilityCandidateSchema = z.object({
  providerId: z.uuid(),
  kind: providerKindSchema,
  displayName: z.string(),
  score: z.number(),
  reasons: z.array(z.object({ factor: z.string(), points: z.number(), detail: z.string() })),
});
export const eligibilityResponseSchema = z.object({
  candidates: z.array(eligibilityCandidateSchema),
});
export type EligibilityResponse = z.infer<typeof eligibilityResponseSchema>;
export type EligibilityCandidate = z.infer<typeof eligibilityCandidateSchema>;

export const createSkillRequestSchema = z.object({
  code: skillCodeSchema,
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(60),
});
export const updateSkillRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    category: z.string().trim().min(2).max(60),
    active: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: 'Nothing to change' });

/** Workspace value for the individual-provider capacity (P5-2). */
export const PROVIDER_WORKSPACE = 'provider';
