/**
 * 作者设计的 logo（v1 的 logo.svg）：递归三层三角形，三层共同重心 (32, 40)。
 * 颜色使用 currentColor，跟随所在位置的文字颜色，从而随皮肤变化。
 */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <polygon points="32,4 4,58 60,58" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <g stroke="currentColor" strokeWidth="1.2" opacity="0.55">
        <line x1="32" y1="4" x2="27.69" y2="20.62" />
        <line x1="32" y1="4" x2="19.08" y2="53.85" />
        <line x1="4" y1="58" x2="19.08" y2="53.85" />
        <line x1="4" y1="58" x2="49.23" y2="45.54" />
        <line x1="60" y1="58" x2="49.23" y2="45.54" />
        <line x1="60" y1="58" x2="27.69" y2="20.62" />
      </g>
      <polygon
        points="27.69,20.62 19.08,53.85 49.23,45.54"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        opacity="0.9"
      />
      <g stroke="currentColor" strokeWidth="1" opacity="0.5">
        <line x1="27.69" y1="20.62" x2="27.36" y2="30.2" />
        <line x1="27.69" y1="20.62" x2="26.7" y2="49.37" />
        <line x1="19.08" y1="53.85" x2="26.7" y2="49.37" />
        <line x1="19.08" y1="53.85" x2="41.94" y2="40.43" />
        <line x1="49.23" y1="45.54" x2="41.94" y2="40.43" />
        <line x1="49.23" y1="45.54" x2="27.36" y2="30.2" />
      </g>
      <polygon
        points="27.36,30.2 26.7,49.37 41.94,40.43"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.18"
        opacity="0.85"
      />
      <circle cx="32" cy="40" r="2" fill="currentColor" />
      <circle cx="32" cy="40" r="4.5" fill="currentColor" opacity="0.15" />
    </svg>
  );
}
