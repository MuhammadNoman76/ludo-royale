// The Ludo Royale mark: a tiny board (four coloured corners) with a crowned die in the middle.
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg class="logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="2" y="2" width="60" height="60" rx="14" fill="#fff" />
      <path d="M16 2h10v24H2V16A14 14 0 0 1 16 2z" fill="#e5484d" />
      <path d="M38 2h10a14 14 0 0 1 14 14v10H38z" fill="#30a46c" />
      <path d="M38 38h24v10a14 14 0 0 1-14 14H38z" fill="#f5b300" />
      <path d="M2 38h24v24H16A14 14 0 0 1 2 48z" fill="#3e8ef7" />
      <rect x="2" y="2" width="60" height="60" rx="14" fill="none" stroke="#000" stroke-opacity=".08" stroke-width="2" />
      <rect x="20" y="22" width="24" height="24" rx="6" fill="#1d2433" />
      <circle cx="26.5" cy="28.5" r="2.6" fill="#fff" />
      <circle cx="32" cy="34" r="2.6" fill="#fff" />
      <circle cx="37.5" cy="39.5" r="2.6" fill="#fff" />
      <path d="M22 19l3.5 3 6.5-6 6.5 6 3.5-3-1.5 6h-17z" fill="#f5b300" stroke="#1d2433" stroke-width="1.4" stroke-linejoin="round" />
    </svg>
  );
}
