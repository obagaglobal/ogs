import { fileURLToPath } from 'node:url';
import { ESLint, type Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * T12: only src/database/ may import Prisma or pg. The rule lives in the root
 * eslint.config.js; this test proves it is wired to the right files and that it
 * actually reports the forbidden imports.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const featureFile = 'apps/api/src/some-feature/some-feature.service.ts';
const databaseFile = 'apps/api/src/database/some-internal.ts';

describe('database boundary lint rule (T12)', () => {
  let featureRules: Partial<Linter.RulesRecord> = {};

  beforeAll(async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const config = (await eslint.calculateConfigForFile(featureFile)) as Linter.Config;
    featureRules = config.rules ?? {};
  });

  it('applies to feature modules but not to src/database', async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const databaseConfig = (await eslint.calculateConfigForFile(databaseFile)) as Linter.Config;
    expect(featureRules['no-restricted-imports']).toBeDefined();
    expect(databaseConfig.rules?.['no-restricted-imports']).toBeUndefined();
  });

  async function lint(code: string): Promise<string[]> {
    const eslint = new ESLint({
      cwd: repoRoot,
      overrideConfigFile: true,
      overrideConfig: {
        files: ['**/*.ts'],
        languageOptions: { parser: tseslint.parser },
        rules: {
          'no-restricted-imports': featureRules['no-restricted-imports'],
          'no-restricted-properties': featureRules['no-restricted-properties'],
        },
      },
    });
    const [result] = await eslint.lintText(code, { filePath: featureFile });
    return (result?.messages ?? []).map((message) => message.ruleId ?? 'fatal');
  }

  it.each([
    "import { PrismaClient } from '../generated/prisma/client.js';",
    "import { PrismaPg } from '@prisma/adapter-pg';",
    "import pg from 'pg';",
    "import { PrismaService } from '../database/prisma.service.js';",
  ])('reports %s', async (code) => {
    expect(await lint(code)).toEqual(['no-restricted-imports']);
  });

  it('reports $queryRawUnsafe', async () => {
    expect(await lint('declare const db: any; db.$queryRawUnsafe("select 1");')).toEqual([
      'no-restricted-properties',
    ]);
  });

  it('allows the public database entry point', async () => {
    expect(await lint("import { TenantDb } from '../database/index.js';")).toEqual([]);
  });
});
