/** Brand-accurate payment method marks drawn as inline SVG — no network assets needed. */

export function CashMark({ size = 30 }: { size?: number }) {
  const h = size * (32 / 48)
  return (
    <svg width={size} height={h} viewBox="0 0 48 32" role="img" aria-label="Cash">
      <rect x="0.75" y="0.75" width="46.5" height="30.5" rx="2" fill="#166534" stroke="#14532d" strokeWidth="1.5" />
      <rect x="5" y="5" width="38" height="22" fill="none" stroke="#86efac" strokeWidth="1.4" strokeDasharray="3 2" />
      <circle cx="24" cy="16" r="7.5" fill="#bbf7d0" />
      <circle cx="24" cy="16" r="5" fill="#16a34a" />
      <circle cx="10" cy="16" r="2.2" fill="#86efac" />
      <circle cx="38" cy="16" r="2.2" fill="#86efac" />
    </svg>
  )
}

export function MpesaMark({ size = 52 }: { size?: number }) {
  const h = size * (32 / 72)
  return (
    <svg width={size} height={h} viewBox="0 0 72 32" role="img" aria-label="M-Pesa">
      <rect x="0.75" y="0.75" width="70.5" height="30.5" rx="3" fill="#ffffff" stroke="#d8dee2" strokeWidth="1.5" />
      <rect x="4" y="4" width="24" height="24" rx="5" fill="#00a859" />
      <path d="M20.4 8.6 13.6 16h4.4l-2.3 7.4L22.6 15h-4.4l2.2-6.4Z" fill="#ffffff" />
      <text
        x="33"
        y="21.5"
        fontSize="12.5"
        fontWeight="800"
        fontFamily="Arial, Helvetica, sans-serif"
        fill="#00a859"
        letterSpacing="0.4"
      >
        M-PESA
      </text>
    </svg>
  )
}

export function CardMark({ size = 52 }: { size?: number }) {
  const h = size * (32 / 72)
  return (
    <svg width={size} height={h} viewBox="0 0 72 32" role="img" aria-label="Card">
      <rect x="0.75" y="0.75" width="70.5" height="30.5" rx="3" fill="#ffffff" stroke="#d8dee2" strokeWidth="1.5" />
      <circle cx="14.5" cy="16" r="8" fill="#eb001b" />
      <circle cx="24.5" cy="16" r="8" fill="#f79e1b" fillOpacity="0.92" />
      <path d="M19.5 8.6a8 8 0 0 1 0 14.8 8 8 0 0 1 0-14.8Z" fill="#ff5f00" />
      <text
        x="37"
        y="21.5"
        fontSize="13"
        fontWeight="800"
        fontStyle="italic"
        fontFamily="Arial, Helvetica, sans-serif"
        fill="#1a1f71"
        letterSpacing="0.6"
      >
        VISA
      </text>
    </svg>
  )
}

export function AccountMark({ size = 30 }: { size?: number }) {
  const h = size * (32 / 48)
  return (
    <svg width={size} height={h} viewBox="0 0 48 32" role="img" aria-label="On account">
      <rect x="5.75" y="1.75" width="36.5" height="28.5" rx="2" fill="#ffffff" stroke="#4f46e5" strokeWidth="2" />
      <rect x="5.75" y="1.75" width="36.5" height="8" rx="2" fill="#4f46e5" />
      <rect x="5.75" y="6" width="36.5" height="4" fill="#4f46e5" />
      <rect x="11" y="14" width="18" height="2.6" rx="1.3" fill="#a5b4fc" />
      <rect x="11" y="19" width="26" height="2.6" rx="1.3" fill="#c7d2fe" />
      <circle cx="33" cy="16.5" r="5.5" fill="#fbbf24" stroke="#d97706" strokeWidth="1.4" />
      <text x="33" y="19.6" fontSize="8" fontWeight="800" fontFamily="Arial" fill="#92400e" textAnchor="middle">
        $
      </text>
    </svg>
  )
}
