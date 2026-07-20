# Collapsible Comments Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an accessible collapse control that restores full document width without disabling comment creation or markers.

**Architecture:** Extend the existing injected review markup, CSS, and embedded script in `src/core/review-annotations.ts`. A single in-memory boolean and `syncDrawerState()` function own the drawer class, accessible toggle state, and desktop document-spacing class so toggle clicks and viewport changes cannot drift.

**Tech Stack:** TypeScript, injected browser HTML/CSS/JavaScript, Vitest, Biome

## Global Constraints

- Comment targets, hover affordances, markers, selection, and click-to-comment behavior remain active while the drawer is collapsed.
- Collapsing restores the document's normal width immediately.
- The collapsed control remains labeled with `Comments` and the current count.
- The drawer starts expanded on every page load; collapse state is not persisted.
- The same control works above and below the `960px` breakpoint.
- No publishing, storage, annotation, or URL contracts change.

---

### Task 1: Add the collapsible comments drawer

**Files:**
- Modify: `src/core/review-annotations.ts`
- Test: `tests/unit/review-annotations.test.ts`

**Interfaces:**
- Consumes: existing `pubmdReviewDrawer`, `pubmdReviewList`, `pubmdReviewCount`, and `pubmd-review-drawer-space` review UI contracts
- Produces: `pubmdReviewDrawerToggle`, `pubmd-review-drawer-collapsed`, and embedded `syncDrawerState()` behavior

- [ ] **Step 1: Write the failing regression test**

Add a focused test that requires the accessible toggle, collapsed class hook, centralized synchronization, click binding, and spacing conditional:

```ts
it("collapses the comments drawer without disabling review mode", () => {
  const html = injectReviewAnnotations(BASIC_HTML);

  expect(html).toContain('id="pubmdReviewDrawerToggle"');
  expect(html).toContain('aria-controls="pubmdReviewList"');
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain(".pubmd-review-drawer.pubmd-review-drawer-collapsed");
  expect(html).toContain("function syncDrawerState()");
  expect(html).toContain(
    'drawer.classList.toggle("pubmd-review-drawer-collapsed", drawerCollapsed);',
  );
  expect(html).toContain(
    'document.body.classList.toggle("pubmd-review-drawer-space", !drawerCollapsed && window.innerWidth >= 961);',
  );
  expect(html).toContain(
    'byId("pubmdReviewDrawerToggle").addEventListener("click"',
  );
});
```

- [ ] **Step 2: Run the focused test and confirm the missing toggle fails**

Run: `npm test -- tests/unit/review-annotations.test.ts`

Expected: one failing test whose first mismatch is the absent `pubmdReviewDrawerToggle`; existing tests remain green.

- [ ] **Step 3: Add the minimal accessible drawer toggle**

In the existing drawer header, retain the `Comments` label and count and add:

```html
<button class="pubmd-review-drawer-toggle" id="pubmdReviewDrawerToggle" type="button" aria-controls="pubmdReviewList" aria-expanded="true" aria-label="Collapse comments">›</button>
```

Add compact button styling plus a higher-specificity collapsed drawer rule that overrides both desktop and mobile positioning:

```css
.pubmd-review-drawer.pubmd-review-drawer-collapsed {
  top: 14px;
  right: 14px;
  bottom: auto;
  left: auto;
  width: auto;
  min-width: 156px;
  max-height: none;
}
.pubmd-review-drawer-collapsed .pubmd-review-list {
  display: none;
}
```

Add `var drawerCollapsed = false;` beside the other embedded-script state. Implement one synchronization function:

```js
function syncDrawerState() {
  var drawer = byId("pubmdReviewDrawer");
  var toggle = byId("pubmdReviewDrawerToggle");
  drawer.classList.toggle("pubmd-review-drawer-collapsed", drawerCollapsed);
  toggle.setAttribute("aria-expanded", drawerCollapsed ? "false" : "true");
  toggle.setAttribute("aria-label", drawerCollapsed ? "Expand comments" : "Collapse comments");
  toggle.textContent = drawerCollapsed ? "‹" : "›";
  document.body.classList.toggle("pubmd-review-drawer-space", !drawerCollapsed && window.innerWidth >= 961);
}
```

Bind the toggle to invert the boolean, synchronize the layout, hide the hover preview, and rerender markers. Call `syncDrawerState()` from the existing resize handler and initialization, replacing the one-off `pubmd-review-drawer-space` toggle. Do not remove `pubmd-review-active` or any annotation listeners.

- [ ] **Step 4: Run the focused test and confirm green**

Run: `npm test -- tests/unit/review-annotations.test.ts`

Expected: all review-annotation tests pass.

- [ ] **Step 5: Run the full project gate and self-review**

Run: `npm run verify`

Expected: all tests, lint, typecheck, and build pass. Review `git diff --check` and the branch diff for scope creep, missing tests, accidental contract changes, and responsive CSS specificity.

- [ ] **Step 6: Commit the implementation**

```bash
git add src/core/review-annotations.ts tests/unit/review-annotations.test.ts docs/superpowers/plans/2026-07-20-collapsible-comments-drawer.md
git commit -m "feat: make comments drawer collapsible"
```
