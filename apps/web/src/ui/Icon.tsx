import React from "react";

const paths: Record<string, React.ReactNode> = {
  // Department marks: one glyph each, same line weight as the rest.
  "dept-exec": (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="1.6" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </>
  ),
  "dept-finance": (
    <>
      <path d="m6 3 6 8 6-8M12 11v10M7 12h10M7 16h10" />
    </>
  ),
  "dept-archive": (
    <>
      <rect x="3.5" y="4" width="4" height="16" rx="0.8" />
      <rect x="9" y="4" width="4" height="16" rx="0.8" />
      <path d="m15 5.2 3.6-1 3 15.4-3.6 1Z" />
    </>
  ),
  "dept-academy": (
    <>
      <circle cx="12" cy="12" r="1.5" />
      <ellipse cx="12" cy="12" rx="9.5" ry="3.8" />
      <ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(120 12 12)" />
    </>
  ),
  home: (
    <>
      <path d="m3 10 9-7 9 7v10H3Z" />
      <path d="M9 20v-7h6v7" />
    </>
  ),
  practice: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m10 8 6 4-6 4Z" />
    </>
  ),
  tasks: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="m8 11 3 3 5-6M8 17h8" />
    </>
  ),
  achievements: (
    <>
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 6H4v2a3 3 0 0 0 3 3m10-5h3v2a3 3 0 0 1-3 3M12 14v5m-4 0h8" />
    </>
  ),
  habits: (
    <>
      <path d="M3 13h4l3-8 4 14 3-8h4" />
    </>
  ),
  expenses: (
    <>
      <rect x="3" y="5" width="18" height="15" rx="2" />
      <path d="M3 9h18m-6 5h3M7 5V3" />
    </>
  ),
  freedom: (
    <>
      <rect x="3" y="3" width="4" height="4" rx="1" />
      <rect x="10" y="3" width="4" height="4" rx="1" />
      <rect x="17" y="3" width="4" height="4" rx="1" />
      <rect x="3" y="10" width="4" height="4" rx="1" />
      <rect x="10" y="10" width="4" height="4" rx="1" fill="currentColor" />
      <rect x="17" y="10" width="4" height="4" rx="1" />
      <rect x="3" y="17" width="4" height="4" rx="1" />
      <rect x="10" y="17" width="4" height="4" rx="1" />
      <rect x="17" y="17" width="4" height="4" rx="1" />
    </>
  ),
  treasury: (
    <>
      <path d="m3 8 9-5 9 5H3Zm1 12h16M6 11v6m6-6v6m6-6v6" />
    </>
  ),
  chronicle: (
    <>
      <path d="M5 3h14v18H5zM8 7h8m-8 4h8m-8 4h5" />
    </>
  ),
  memoir: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v18H6.5A2.5 2.5 0 0 1 4 18.5Z" />
      <path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H19M8 7h7m-7 4h5" />
    </>
  ),
  storage: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M10 10v3h4v-3" />
    </>
  ),
  raw: (
    <>
      <path d="M4 5h10M4 10h8M4 15h6m4 5-3 1 1-3L20 10l2 2Z" />
    </>
  ),
  monthly: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4m10-4v4M3 10h18m-13 4h2m4 0h2m-8 3h2" />
    </>
  ),
  notes: (
    <>
      <path d="M12 5C8 2 4 3 2 4v16c3-2 7-2 10 0 3-2 7-2 10 0V4c-3-2-7-1-10 1Zm0 0v15" />
    </>
  ),
  thoughts: (
    <>
      <path d="M8 16c0-2-3-3-3-7a7 7 0 0 1 14 0c0 4-3 5-3 7ZM9 20h6m-5 3h4" />
    </>
  ),
  ideas: (
    <>
      <path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" />
    </>
  ),
  reading: <path d="M6 3h12v18l-6-4-6 4Z" />,
  checklists: (
    <>
      <path
        d="m3 6 2 2 3-4m3 3h10M3 14l2 2 3-4m3 3h10M3 22l2 2 3-4m3 3h10"
        transform="translate(0 -2)"
      />
    </>
  ),
  metrics: (
    <>
      <path d="M3 3v18h18M7 16l4-6 4 3 6-8" />
    </>
  ),
  days: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  departments: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  shortcuts: (
    <>
      <path d="m13 2-8 12h6l-1 8 9-13h-7Z" />
    </>
  ),
  discover: (
    <>
      <circle cx="10.5" cy="10.5" r="7" />
      <path d="m16 16 5 5" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="3" />
      <circle cx="15" cy="17" r="3" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
  ),
  moon: <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z" />,
  split: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </>
  ),
  sidebar: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>
  ),
  "chevron-left": <path d="m15 6-6 6 6 6" />,
  "chevron-right": <path d="m9 6 6 6-6 6" />,
  back: <path d="m10 5-7 7 7 7M3 12h18" />,
  arrow: <path d="M5 19 19 5M6 5h13v13" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  sync: (
    <>
      <path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5m-4 8a8 8 0 0 0 14 3l3-3m0 5v-5h-5" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />,
  plus: <path d="M12 4v16M4 12h16" />,
  play: <path d="m7 5 12 7-12 7Z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  ellipsis: (
    <>
      <circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  review: (
    <>
      <rect x="4" y="13" width="3.5" height="7" rx="1" />
      <rect x="10.25" y="8" width="3.5" height="12" rx="1" />
      <rect x="16.5" y="4" width="3.5" height="16" rx="1" />
    </>
  ),
  "today-grid": (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="8" cy="6" r="2" fill="var(--bg)" />
      <circle cx="16" cy="12" r="2" fill="var(--bg)" />
      <circle cx="10" cy="18" r="2" fill="var(--bg)" />
    </>
  ),
  "dept-tab": (
    <>
      <path d="M4 20h16M6 20V7a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v13" />
      <path d="M14 20v-9a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v9" />
      <path d="M9 10h2M9 14h2" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.08a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </>
  ),
  check: <path d="m4 12 5 5L20 6" />,
  edit: <path d="m15 5 4 4M4 20l1-5L16 4a2.8 2.8 0 0 1 4 4L9 19Z" />,
};

/** Shared local line icons keep navigation legible without platform font glyphs. */
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name] ?? paths.notes}
    </svg>
  );
}
