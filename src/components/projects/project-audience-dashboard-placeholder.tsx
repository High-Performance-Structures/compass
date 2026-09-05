import type * as React from "react"

export function ProjectAudienceDashboardPlaceholder(): React.ReactElement {
  return (
    <div className="relative flex h-full min-h-64 flex-col justify-end overflow-hidden bg-gradient-to-br from-primary/10 via-background to-muted/30">
      <svg
        viewBox="0 0 300 340"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full text-primary"
        role="img"
        aria-label="Architectural illustration of a home under construction"
      >
        <g stroke="currentColor" strokeWidth="0.5" opacity="0.08">
          {[35, 65, 95, 125, 155, 185, 215, 245, 275, 305].map((y) => (
            <path key={`horizontal-${y}`} d={`M0 ${y}H300`} />
          ))}
          {[25, 55, 85, 115, 145, 175, 205, 235, 265, 295].map((x) => (
            <path key={`vertical-${x}`} d={`M${x} 0V340`} />
          ))}
        </g>
        <circle
          cx="69"
          cy="61"
          r="21"
          className="fill-brand-nutech-gold/10 stroke-brand-nutech-gold/30"
          strokeWidth="0.75"
        />
        <g
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            d="M27 216 133 248 273 196M27 224 133 256 273 204"
            strokeWidth="1"
            opacity="0.25"
          />
          <path
            d="M48 150 133 176 250 137 164 111Z"
            className="fill-primary/5"
            strokeWidth="1.2"
            opacity="0.65"
          />
          <path
            d="M48 150V213L133 239 250 199V137M133 176V239"
            strokeWidth="1.5"
            opacity="0.7"
          />
          <path
            d="M40 151 87 91 166 114M87 91 133 174M87 101V163M65 126 111 141M54 144 126 166"
            strokeWidth="1.5"
            opacity="0.8"
          />
          <path
            d="M87 91 204 53 258 137 133 178M111 83 157 169M135 75 181 161M159 68 205 153M183 60 229 145M204 53V152"
            strokeWidth="1.3"
            opacity="0.65"
          />
          <path
            d="M58 160V210M77 166V216M96 172V222M115 178V228M151 175V231M178 166V222M205 157V213M232 148V204"
            strokeWidth="0.8"
            opacity="0.35"
          />
          <path
            d="M66 180 90 187V208L66 201ZM170 185 199 175V200L170 210ZM217 169 237 162V185L217 192ZM106 191 122 196V235L106 230Z"
            className="fill-background"
            strokeWidth="1.2"
            opacity="0.8"
          />
          <path
            d="M31 239 119 266M28 235V243M122 262V270M146 267 263 226M144 263V271M265 222V230"
            strokeWidth="0.65"
            opacity="0.3"
          />
        </g>
      </svg>
      <div className="relative bg-gradient-to-t from-background via-background/90 to-transparent px-4 pt-12 pb-5 pr-8">
        <p className="text-xs font-medium text-primary">
          Your project, taking shape
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Approved project photos will appear here.
        </p>
      </div>
    </div>
  )
}
