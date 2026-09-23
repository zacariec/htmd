/**
 * Representative model-authored Markdown. Streaming property tests replay each
 * sample at every character boundary.
 */
export const MARKDOWN_CORPUS: Readonly<Record<string, string>> = {
  emphasis:
    'Revenue grew **12% quarter over quarter**, driven by *enterprise* renewals and ~~one-off~~ recurring deals. Keep `snake_case` names and 2*3 literal.',
  links:
    'See [the Q4 report](https://example.com/reports/q4?view=full) and ![weekly chart](https://example.com/q4.png). Raw link: https://example.com/status then more text.',
  headings:
    '# Quarterly review\n\nSummary paragraph.\n\n## What changed\n\nDetails follow.\n\nSetext title\n------------\n\nClosing words.',
  lists:
    'Next steps:\n\n1. Build the **Q1 forecast**\n2. Review `churn.sql`\n   - check w49\n   - confirm the fix\n3. Ship it\n\n- [ ] draft summary\n- [x] collect data\n\n* star bullet\n+ plus bullet',
  code: 'The fix:\n\n```ts\nconst corrected = invoices.filter((invoice) => !invoice.voided);\n// **not bold** and [not a link](x)\n```\n\nThen rerun with `pnpm test --filter api`.',
  table:
    '| Week | Revenue | Note |\n| ---- | ------: | ---- |\n| w48 | 1.2M | steady |\n| w49 | **0.8M** | billing bug |\n\nTable ends here.',
  quote: '> **Note:** churn is flat at 2.1%.\n> Watch the `billing` service.\n\nAfter the quote.',
  edges:
    'As shown in [1], 5 * 3 = 15 and a_b_c stays. Use ``code with ` inside`` here. Write to ops@example.com or <https://example.com/help>.\n\n10. Tenth item with ~~old~~ text\n11. Eleventh\n\n> - quoted list **item**\n> - second\n\n~~~\nTilde fence with ``` inside\n~~~\n\nDone!',
  mixed:
    'Looking at *Q4* now.\n\n---\n\nThe `__init__` hook and __strong underscores__ both matter; see [docs](https://example.com/docs "Docs").\n\n***Very important*** closing.',
};
