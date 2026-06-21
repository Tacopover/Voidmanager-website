/**
 * BrandMark — the Void Manager brand glyph: a BLUE structural ring around a
 * GREEN void core (echoes the logo). Shared between the marketing Home page
 * (window-bar glyph) and the dark Viewer (top bar + DbLoader landing).
 *
 * Pure inline SVG so it scales crisply at any size and carries no icon-font
 * dependency. Colours are the brand duo; pass `ring`/`core` to override.
 */

interface BrandMarkProps {
  /** Rendered width/height in px. Default 15 (window-bar size). */
  size?: number;
  /** Optional className (kept for Home's `.win-glyph` flex rule). */
  className?: string;
  /** Ring (structure) colour. Default brand blue. */
  ring?: string;
  /** Core (void) colour. Default vivid green. */
  core?: string;
}

export default function BrandMark({
  size = 15,
  className,
  ring = '#3278c8',
  core = '#5bc46a',
}: BrandMarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.4" fill="none" stroke={ring} strokeWidth="1.6" />
      <circle cx="8" cy="8" r="2.5" fill={core} />
    </svg>
  );
}
