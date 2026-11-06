import { Injectable } from '@nestjs/common';
import type { EligibilityCandidate } from '@ogs/contracts';
import { Prisma, TenantDb, type DbContext } from '../database/index.js';

/**
 * Score weights (Phase 5 plan §2.4): a plain, documented sum. Each candidate
 * gets one reason per factor, so staff can see why it ranks where it does.
 * There is no learning and no auto-assignment (review §10).
 */
export const ELIGIBILITY_WEIGHTS = {
  /** Per required skill (all are required, so this is equal for every candidate). */
  skill: 10,
  /** Per required skill, by declared experience. */
  experience: { UNDER_1_YEAR: 0, YEARS_1_3: 1, YEARS_3_5: 2, OVER_5_YEARS: 3 },
  /** The provider covers the requested county. */
  regionCovered: 20,
  /** Its home county is the requested county. */
  homeRegion: 5,
  /** Not covering the county but working remotely (only when the request allows remote). */
  remote: 5,
  /** Available at the requested time (or now, when no time was given). */
  available: 15,
} as const;

/** Working hours and time off are local to Kenya (plan §2.3). */
export const PROVIDER_TIME_ZONE = 'Africa/Nairobi';
const NAIROBI_TIME = new Intl.DateTimeFormat('en-KE', {
  timeZone: PROVIDER_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});

export interface EligibilityQuery {
  readonly skillCodes: readonly string[];
  readonly regionCode: string;
  /** When given, the provider must be available at this instant (hard filter). */
  readonly at?: Date;
  /** The service may be delivered remotely: remote providers outside the county qualify. */
  readonly remoteAllowed?: boolean;
}

interface Row {
  id: string;
  kind: 'COMPANY' | 'INDIVIDUAL';
  display_name: string;
  covers: boolean;
  home: boolean;
  available: boolean;
  matched: { code: string; experience: keyof typeof ELIGIBILITY_WEIGHTS.experience }[];
}

/**
 * Which approved providers could take a job (plan §2.4). The hard filters run
 * in SQL, so an unapproved, suspended, paused, unskilled, out-of-region or
 * (with `at`) unavailable provider is never returned, whatever the scoring does.
 */
@Injectable()
export class EligibilityService {
  constructor(private readonly db: TenantDb) {}

  async find(ctx: DbContext, query: EligibilityQuery): Promise<EligibilityCandidate[]> {
    const skills = [...new Set(query.skillCodes)];
    const when = query.at ?? new Date();
    const requireAvailable = query.at !== undefined;
    const remoteAllowed = query.remoteAllowed ?? false;
    const rows = await this.db.run(ctx, async (tx) =>
      tx.$queryRaw<Row[]>(Prisma.sql`
        WITH params AS (
          SELECT ${skills}::text[] AS skills,
                 ${query.regionCode}::text AS region,
                 (${when}::timestamptz AT TIME ZONE ${PROVIDER_TIME_ZONE}) AS local_at,
                 ${when}::timestamptz AS at
        ),
        candidates AS (
          SELECT p.id, p.kind, p.display_name, p.home_region, p.remote_ok,
                 EXISTS (SELECT 1 FROM provider_region r
                          WHERE r.provider_id = p.id AND r.region_code = params.region) AS covers,
                 (EXISTS (SELECT 1 FROM provider_working_hours h
                           WHERE h.provider_id = p.id
                             AND h.weekday = EXTRACT(ISODOW FROM params.local_at)
                             AND h.start_minute <= EXTRACT(HOUR FROM params.local_at) * 60
                                                   + EXTRACT(MINUTE FROM params.local_at)
                             AND h.end_minute > EXTRACT(HOUR FROM params.local_at) * 60
                                                 + EXTRACT(MINUTE FROM params.local_at))
                  AND NOT EXISTS (SELECT 1 FROM provider_time_off o
                                   WHERE o.provider_id = p.id
                                     AND o.starts_at <= params.at AND o.ends_at > params.at)
                 ) AS available
            FROM provider p
            CROSS JOIN params
            JOIN provider_application a ON a.provider_id = p.id AND a.status = 'APPROVED'
            LEFT JOIN tenant t ON t.id = p.tenant_id
           WHERE p.status = 'ACTIVE'
             AND p.accepting_work
             AND (p.kind = 'INDIVIDUAL' OR (t.status = 'ACTIVE' AND t.deleted_at IS NULL))
             AND NOT EXISTS (
                   SELECT 1 FROM unnest(params.skills) AS required(code)
                    WHERE NOT EXISTS (SELECT 1 FROM provider_skill s
                                       WHERE s.provider_id = p.id AND s.skill_code = required.code))
        )
        SELECT c.id, c.kind::text AS kind, c.display_name, c.covers, c.available,
               (c.home_region = params.region) IS TRUE AS home,
               COALESCE((SELECT json_agg(json_build_object('code', s.skill_code,
                                                           'experience', s.experience::text)
                                          ORDER BY s.skill_code)
                           FROM provider_skill s
                          WHERE s.provider_id = c.id AND s.skill_code = ANY (params.skills)),
                        '[]'::json) AS matched
          FROM candidates c
          CROSS JOIN params
         WHERE (c.covers OR (${remoteAllowed} AND c.remote_ok))
           AND (NOT ${requireAvailable} OR c.available)
         LIMIT 500
      `),
    );
    return rows
      .map((row) => score(row, query.regionCode, when, requireAvailable))
      .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName))
      .slice(0, 50);
  }
}

function score(row: Row, region: string, when: Date, atRequested: boolean): EligibilityCandidate {
  const w = ELIGIBILITY_WEIGHTS;
  const reasons: EligibilityCandidate['reasons'] = [];
  reasons.push({
    factor: 'skills',
    points: row.matched.length * w.skill,
    detail: `Has all ${String(row.matched.length)} required skill(s)`,
  });
  const experience = row.matched.reduce((sum, skill) => sum + w.experience[skill.experience], 0);
  reasons.push({
    factor: 'experience',
    points: experience,
    detail: row.matched.map((skill) => `${skill.code}: ${skill.experience}`).join(', ') || 'none',
  });
  reasons.push(
    row.covers
      ? { factor: 'region', points: w.regionCovered, detail: `Covers ${region}` }
      : { factor: 'region', points: w.remote, detail: `Works remotely (does not cover ${region})` },
  );
  reasons.push({
    factor: 'home_region',
    points: row.home ? w.homeRegion : 0,
    detail: row.home ? `Based in ${region}` : 'Based elsewhere',
  });
  const moment = atRequested ? `at ${NAIROBI_TIME.format(when)} (Kenya time)` : 'now';
  reasons.push({
    factor: 'availability',
    points: row.available ? w.available : 0,
    detail: row.available ? `Available ${moment}` : `Not available ${moment}`,
  });
  return {
    providerId: row.id,
    kind: row.kind,
    displayName: row.display_name,
    score: reasons.reduce((sum, reason) => sum + reason.points, 0),
    reasons,
  };
}
