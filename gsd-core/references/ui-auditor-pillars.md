<audit_pillars>

## 6-Pillar Scoring (1-4 per pillar)

**Score definitions:**
- **4** — Excellent: No issues found, exceeds contract
- **3** — Good: Minor issues, contract substantially met
- **2** — Needs work: Notable gaps, contract partially met
- **1** — Poor: Significant issues, contract not met

### Pillar 1: Copywriting

**Audit method:** Grep for string literals, check component text content.

```bash
# Find generic labels
grep -rn "Submit\|Click Here\|OK\|Cancel\|Save" src --include="*.tsx" --include="*.jsx" 2>/dev/null
# Find empty state patterns
grep -rn "No data\|No results\|Nothing\|Empty" src --include="*.tsx" --include="*.jsx" 2>/dev/null
# Find error patterns
grep -rn "went wrong\|try again\|error occurred" src --include="*.tsx" --include="*.jsx" 2>/dev/null
```

**If UI-SPEC exists:** Compare each declared CTA/empty/error copy against actual strings.
**If no UI-SPEC:** Flag generic patterns against UX best practices.

### Pillar 2: Visuals

**Audit method:** Check component structure, visual hierarchy indicators.

- Is there a clear focal point on the main screen?
- Are icon-only buttons paired with aria-labels or tooltips?
- Is there visual hierarchy through size, weight, or color differentiation?

### Pillar 3: Color

**Audit method:** Grep Tailwind classes and CSS custom properties.

```bash
# Count accent color usage
grep -rn "text-primary\|bg-primary\|border-primary" src --include="*.tsx" --include="*.jsx" 2>/dev/null | wc -l
# Check for hardcoded colors
grep -rn "#[0-9a-fA-F]\{3,8\}\|rgb(" src --include="*.tsx" --include="*.jsx" 2>/dev/null
```

**If UI-SPEC exists:** Verify accent is only used on declared elements.
**If no UI-SPEC:** Flag accent overuse (>10 unique elements) and hardcoded colors.

### Pillar 4: Typography

**Audit method:** Grep font size and weight classes.

```bash
# Count distinct font sizes in use
grep -rohn "text-\(xs\|sm\|base\|lg\|xl\|2xl\|3xl\|4xl\|5xl\)" src --include="*.tsx" --include="*.jsx" 2>/dev/null | sort -u
# Count distinct font weights
grep -rohn "font-\(thin\|light\|normal\|medium\|semibold\|bold\|extrabold\)" src --include="*.tsx" --include="*.jsx" 2>/dev/null | sort -u
```

**If UI-SPEC exists:** Verify only declared sizes and weights are used.
**If no UI-SPEC:** Flag if >4 font sizes or >2 font weights in use.

### Pillar 5: Spacing

**Audit method:** Grep spacing classes, check for non-standard values.

```bash
# Find spacing classes
grep -rohn "p-\|px-\|py-\|m-\|mx-\|my-\|gap-\|space-" src --include="*.tsx" --include="*.jsx" 2>/dev/null | sort | uniq -c | sort -rn | head -20
# Check for arbitrary values
grep -rn "\[.*px\]\|\[.*rem\]" src --include="*.tsx" --include="*.jsx" 2>/dev/null
```

**If UI-SPEC exists:** Verify spacing matches declared scale.
**If no UI-SPEC:** Flag arbitrary spacing values and inconsistent patterns.

### Pillar 6: Experience Design

**Audit method:** Check for state coverage and interaction patterns.

```bash
# Loading states
grep -rn "loading\|isLoading\|pending\|skeleton\|Spinner" src --include="*.tsx" --include="*.jsx" 2>/dev/null
# Error states
grep -rn "error\|isError\|ErrorBoundary\|catch" src --include="*.tsx" --include="*.jsx" 2>/dev/null
# Empty states
grep -rn "empty\|isEmpty\|no.*found\|length === 0" src --include="*.tsx" --include="*.jsx" 2>/dev/null
```

Score based on: loading states present, error boundaries exist, empty states handled, disabled states for actions, confirmation for destructive actions.

</audit_pillars>
