// @ts-check
/**
 * Design system guard (Phase 6b, ADR-055): colours come from tokens only.
 * Reports raw hex / rgb() / hsl() / oklch() values and Tailwind palette colour
 * classes (bg-emerald-50, text-white …) in string and template literals.
 * src/styles/tokens.css is the single place raw colours may appear; CSS files
 * are checked by apps/web/src/test/no-raw-colours.test.ts with the same
 * patterns (exported from here).
 */

export const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(/;

const UTILITIES =
  'bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|divide|placeholder|accent|caret|shadow';
const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
export const PALETTE_CLASS = new RegExp(
  `(?:^|[\\s:'"\`])-?(?:${UTILITIES})-(?:(?:${PALETTE})-\\d{2,3}|white|black)(?![\\w-])`,
);

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Use design-system tokens instead of raw colours' },
    messages: {
      raw: 'Use a design-system token (src/styles/tokens.css), not a raw colour.',
      palette:
        'Use a design-system token class (bg-surface, text-success …), not a Tailwind palette colour.',
    },
    schema: [],
  },
  create(context) {
    /** @param {import('estree').Node} node @param {string} text */
    const check = (node, text) => {
      if (RAW_COLOUR.test(text)) {
        context.report({ node, messageId: 'raw' });
      } else if (PALETTE_CLASS.test(text)) {
        context.report({ node, messageId: 'palette' });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
    };
  },
};

export default { rules: { 'no-raw-colours': rule } };
