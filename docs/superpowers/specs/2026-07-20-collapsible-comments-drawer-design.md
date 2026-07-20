# Collapsible Comments Drawer Design

## Goal

Let readers reclaim the full document width while comments mode remains active.

## Interaction

- The comments drawer starts expanded, matching the current behavior.
- Its header includes a keyboard-accessible toggle with `aria-controls` and `aria-expanded`.
- Collapsing hides only the comments list and reduces the drawer to a compact, labeled `Comments` tab that continues to show the current comment count.
- Collapsing restores the document's normal width immediately.
- Comment targets, hover affordances, markers, selection, and click-to-comment behavior remain active while the drawer is collapsed.
- Activating the compact tab expands the drawer again.
- The collapse state lasts for the current page session only; every page load starts expanded.

## Responsive Behavior

The same control works at desktop and mobile breakpoints. The collapsed tab remains visible in the top-right corner and does not retain the mobile drawer's full-width positioning.

## Implementation

Keep the change inside the existing injected review UI in `src/core/review-annotations.ts`:

- add the toggle to the drawer header;
- add a collapsed drawer class and compact styling;
- centralize drawer class, ARIA, label, and document-spacing updates in one synchronization function;
- call that function at initialization, on toggle, and on resize.

No publishing, storage, annotation, or URL contracts change.

## Verification

- Add a focused unit regression test for the toggle markup, accessible state, compact class, event binding, and conditional document spacing.
- Run `npm run verify`.
- Browser-test expanded, collapsed, and reopened states at desktop and mobile widths.
- After deployment, republish the affected HTML page and repeat the interaction smoke test on its public comments URL.
