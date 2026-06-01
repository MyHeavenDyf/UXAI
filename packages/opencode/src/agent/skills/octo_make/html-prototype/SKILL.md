---
name: html-prototype
description: Generate high-fidelity interactive HTML prototypes with design system support
---

# HTML Prototype

Generate structured design prototypes using the `<artifact>` tag format.

**IMPORTANT**: Output ALL HTML inside `<artifact>` tags in your text response. Do NOT use write, edit, or file-editing tools. The user can only see your work through artifact preview cards.

## Artifact Output Format

```
<artifact identifier="name" type="html" title="Title">
<!DOCTYPE html>
<html>...</html>
</artifact>
```

## Supported Artifact Types

- **html** — Landing pages, dashboards, web apps, marketing pages
- **deck** — Slide presentations with `<div class="slide">` wrapper per slide
- **svg** — Icons, illustrations, diagrams
- **markdown-document** — Structured documents
- **code-snippet** — Source code files

## Design System Binding

When a design system is active:
1. Include the `:root` CSS block from tokens.css verbatim
2. Use only the defined color palette, typography scale, and spacing tokens
3. Follow component patterns from DESIGN.md
4. Never override design system values with arbitrary values

## Prototype Patterns

### Landing Page
- Hero section with clear value proposition
- Feature grid with icons
- CTA section
- Footer

### Dashboard
- Sidebar navigation
- Metric cards row
- Data table or chart area
- Filter/search bar

### Mobile App
- Bottom tab navigation
- Card-based content layout
- Pull-to-refresh indicators
- Action buttons within thumb reach
