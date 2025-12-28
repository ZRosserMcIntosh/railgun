# Website Theme Color Update - Green to Dark Purple

## Summary
Successfully updated the Rail Gun website theme from green/indigo to dark purple.

## Changes Made

### 1. Tailwind Configuration (`railgun-site/tailwind.config.ts`)
Updated the accent color palette:

| Property | Old Value | New Value | Color |
|----------|-----------|-----------|-------|
| `accent.DEFAULT` | `#6366f1` | `#8b5cf6` | Indigo → Purple |
| `accent.hover` | `#4f46e5` | `#7c3aed` | Dark Indigo → Dark Purple |
| `accent.light` | `#818cf8` | `#a78bfa` | Light Indigo → Light Purple |

### 2. Global Styles (`src/app/globals.css`)
Updated color references:

- **Selection highlight**: Changed from `rgba(99, 102, 241, 0.3)` to `rgba(139, 92, 246, 0.3)`
- **Focus outline**: Changed from `#6366f1` to `#8b5cf6`

## Color Palette

### New Dark Purple Theme
```
Primary Accent:   #8b5cf6  (Purple-500)
Hover State:      #7c3aed  (Purple-600)
Light Variant:    #a78bfa  (Purple-400)
```

### Existing Dark Backgrounds (Unchanged)
```
Background Primary:   #0f0f10
Background Secondary: #1a1a1c
Background Elevated:  #242428
Text Primary:         #ffffff
Text Secondary:       #a0a0a0
```

## Components Affected
The following components will automatically update with the new purple theme:

- ✅ CTA (Call-to-Action) sections
- ✅ Primary buttons
- ✅ Accent highlights
- ✅ Gradient backgrounds
- ✅ Hover states
- ✅ Focus indicators
- ✅ Link hover effects

## How It Works
All color changes are applied through:
1. **Tailwind CSS** - `accent-*` classes throughout components
2. **CSS Variables** - `var(--accent)` and related variables
3. **Inline Styles** - Direct color hex values

The Tailwind config is the single source of truth, so all components that use `bg-accent`, `text-accent`, `hover:bg-accent-hover`, etc. will automatically use the new purple colors.

## Testing the Changes

To see the new theme in action:

```bash
cd railgun-site
pnpm dev
```

Visit `http://localhost:3000` and you should see:
- Dark purple buttons and CTAs
- Purple highlights and accents
- Purple focus rings on interactive elements
- Purple selection highlights

## Reverting (if needed)

To revert to the old indigo theme:

**tailwind.config.ts:**
```typescript
accent: {
  DEFAULT: '#6366f1',
  hover: '#4f46e5',
  light: '#818cf8',
}
```

**globals.css:**
```css
::selection { background: rgba(99, 102, 241, 0.3); }
*:focus-visible { outline: 2px solid #6366f1; }
```

## Color Progression

The new purple color uses Tailwind's purple scale:
- **#a78bfa** - Light (Purple-400) - Used for light backgrounds/overlays
- **#8b5cf6** - Standard (Purple-500) - Main accent color
- **#7c3aed** - Dark (Purple-600) - Hover states for better contrast

This provides excellent contrast with the dark background while maintaining visual hierarchy.
