/**
 * Round, simplified country flags for category lists. Drawn as SVG instead of
 * flag emoji because Windows renders flag emoji as plain letters. Shapes are
 * deliberately reduced (no coats of arms or stars) so they stay legible at
 * 30–40 px; unknown countries fall back to a neutral TV glyph.
 */
import type { JSX } from 'preact';
import { TvIcon } from './icon';

type Shape = (props: { w: number; h: number }) => JSX.Element;

const stripes =
    (direction: 'h' | 'v', colors: string[], weights?: number[]): Shape =>
    ({ w, h }) => {
        const total = (weights ?? colors.map(() => 1)).reduce((a, b) => a + b, 0);
        let offset = 0;
        return (
            <>
                {colors.map((color, index) => {
                    const share = (weights?.[index] ?? 1) / total;
                    const size = (direction === 'h' ? h : w) * share;
                    const rect =
                        direction === 'h' ? (
                            <rect x={0} y={offset} width={w} height={size + 0.5} fill={color} />
                        ) : (
                            <rect x={offset} y={0} width={size + 0.5} height={h} fill={color} />
                        );
                    offset += size;
                    return rect;
                })}
            </>
        );
    };

const nordic =
    (background: string, cross: string, inner?: string): Shape =>
    ({ w, h }) => (
        <>
            <rect width={w} height={h} fill={background} />
            <rect x={w * 0.28} y={0} width={w * 0.16} height={h} fill={cross} />
            <rect x={0} y={h * 0.38} width={w} height={h * 0.24} fill={cross} />
            {inner ? (
                <>
                    <rect x={w * 0.32} y={0} width={w * 0.08} height={h} fill={inner} />
                    <rect x={0} y={h * 0.44} width={w} height={h * 0.12} fill={inner} />
                </>
            ) : null}
        </>
    );

const FLAGS: Record<string, Shape> = {
    DE: stripes('h', ['#000000', '#DD0000', '#FFCE00']),
    AT: stripes('h', ['#ED2939', '#FFFFFF', '#ED2939']),
    CH: ({ w, h }) => (
        <>
            <rect width={w} height={h} fill="#DA291C" />
            <rect x={w * 0.43} y={h * 0.2} width={w * 0.14} height={h * 0.6} fill="#FFFFFF" />
            <rect x={w * 0.32} y={h * 0.4} width={w * 0.36} height={h * 0.2} fill="#FFFFFF" />
        </>
    ),
    GB: ({ w, h }) => (
        <>
            <rect width={w} height={h} fill="#012169" />
            <path d={`M0 0L${w} ${h}M${w} 0L0 ${h}`} stroke="#FFFFFF" stroke-width={h * 0.2} />
            <path d={`M0 0L${w} ${h}M${w} 0L0 ${h}`} stroke="#C8102E" stroke-width={h * 0.07} />
            <path d={`M${w / 2} 0V${h}M0 ${h / 2}H${w}`} stroke="#FFFFFF" stroke-width={h * 0.33} />
            <path d={`M${w / 2} 0V${h}M0 ${h / 2}H${w}`} stroke="#C8102E" stroke-width={h * 0.2} />
        </>
    ),
    US: ({ w, h }) => (
        <>
            {stripes('h', Array.from({ length: 7 }, (_, i) => (i % 2 ? '#FFFFFF' : '#B22234')))({ w, h })}
            <rect width={w * 0.45} height={h * 0.54} fill="#3C3B6E" />
        </>
    ),
    FR: stripes('v', ['#0055A4', '#FFFFFF', '#EF4135']),
    IT: stripes('v', ['#009246', '#FFFFFF', '#CE2B37']),
    ES: stripes('h', ['#AA151B', '#F1BF00', '#AA151B'], [1, 2, 1]),
    NL: stripes('h', ['#AE1C28', '#FFFFFF', '#21468B']),
    BE: stripes('v', ['#000000', '#FAE042', '#ED2939']),
    PL: stripes('h', ['#FFFFFF', '#DC143C']),
    TR: ({ w, h }) => (
        <>
            <rect width={w} height={h} fill="#E30A17" />
            <circle cx={w * 0.42} cy={h / 2} r={h * 0.25} fill="#FFFFFF" />
            <circle cx={w * 0.47} cy={h / 2} r={h * 0.2} fill="#E30A17" />
            <circle cx={w * 0.63} cy={h / 2} r={h * 0.08} fill="#FFFFFF" />
        </>
    ),
    PT: stripes('v', ['#006600', '#FF0000'], [2, 3]),
    GR: ({ w, h }) => (
        <>
            {stripes('h', Array.from({ length: 9 }, (_, i) => (i % 2 ? '#FFFFFF' : '#0D5EAF')))({ w, h })}
            <rect width={w * 0.4} height={h * 0.56} fill="#0D5EAF" />
            <rect x={w * 0.16} width={w * 0.08} height={h * 0.56} fill="#FFFFFF" />
            <rect y={h * 0.22} width={w * 0.4} height={h * 0.11} fill="#FFFFFF" />
        </>
    ),
    RO: stripes('v', ['#002B7F', '#FCD116', '#CE1126']),
    AL: ({ w, h }) => (
        <>
            <rect width={w} height={h} fill="#E41E20" />
            <circle cx={w / 2} cy={h / 2} r={h * 0.22} fill="#000000" />
        </>
    ),
    HR: stripes('h', ['#FF0000', '#FFFFFF', '#171796']),
    RS: stripes('h', ['#C6363C', '#0C4076', '#FFFFFF']),
    BA: ({ w, h }) => (
        <>
            <rect width={w} height={h} fill="#002395" />
            <path d={`M${w * 0.28} 0H${w * 0.72}V${h}Z`} fill="#FECB00" />
        </>
    ),
    BG: stripes('h', ['#FFFFFF', '#00966E', '#D62612']),
    HU: stripes('h', ['#CE2939', '#FFFFFF', '#477050']),
    CZ: ({ w, h }) => (
        <>
            {stripes('h', ['#FFFFFF', '#D7141A'])({ w, h })}
            <path d={`M0 0L${w * 0.5} ${h / 2}L0 ${h}Z`} fill="#11457E" />
        </>
    ),
    SK: stripes('h', ['#FFFFFF', '#0B4EA2', '#EE1C25']),
    SE: nordic('#006AA7', '#FECC00'),
    NO: nordic('#BA0C2F', '#FFFFFF', '#00205B'),
    DK: nordic('#C8102E', '#FFFFFF'),
    FI: nordic('#FFFFFF', '#002F6C'),
    IE: stripes('v', ['#169B62', '#FFFFFF', '#FF883E']),
    RU: stripes('h', ['#FFFFFF', '#0039A6', '#D52B1E']),
    UA: stripes('h', ['#0057B7', '#FFD700']),
    IN: ({ w, h }) => (
        <>
            {stripes('h', ['#FF9933', '#FFFFFF', '#138808'])({ w, h })}
            <circle cx={w / 2} cy={h / 2} r={h * 0.12} fill="#000080" />
        </>
    ),
    PK: ({ w, h }) => (
        <>
            <rect width={w} height={h} fill="#01411C" />
            <rect width={w * 0.25} height={h} fill="#FFFFFF" />
            <circle cx={w * 0.62} cy={h / 2} r={h * 0.26} fill="#FFFFFF" />
            <circle cx={w * 0.67} cy={h * 0.45} r={h * 0.22} fill="#01411C" />
        </>
    ),
    BR: ({ w, h }) => (
        <>
            <rect width={w} height={h} fill="#009C3B" />
            <path d={`M${w / 2} ${h * 0.1}L${w * 0.92} ${h / 2}L${w / 2} ${h * 0.9}L${w * 0.08} ${h / 2}Z`} fill="#FFDF00" />
            <circle cx={w / 2} cy={h / 2} r={h * 0.21} fill="#002776" />
        </>
    ),
    MX: stripes('v', ['#006847', '#FFFFFF', '#CE1126']),
    CA: ({ w, h }) => (
        <>
            {stripes('v', ['#D80621', '#FFFFFF', '#D80621'], [1, 2, 1])({ w, h })}
            <rect x={w * 0.42} y={h * 0.3} width={w * 0.16} height={h * 0.4} fill="#D80621" />
        </>
    ),
    AU: ({ w, h }) => (
        <>
            <rect width={w} height={h} fill="#012169" />
            <circle cx={w * 0.7} cy={h * 0.3} r={h * 0.06} fill="#FFFFFF" />
            <circle cx={w * 0.8} cy={h * 0.55} r={h * 0.06} fill="#FFFFFF" />
            <circle cx={w * 0.65} cy={h * 0.75} r={h * 0.06} fill="#FFFFFF" />
            <circle cx={w * 0.3} cy={h * 0.72} r={h * 0.09} fill="#FFFFFF" />
        </>
    ),
};

export function hasFlag(country: string | null | undefined): boolean {
    return !!country && country in FLAGS;
}

export function Flag({ country }: { country: string | null | undefined }) {
    const Shape = country ? FLAGS[country] : undefined;
    if (!Shape)
        return (
            <span class="flag flag-generic" aria-hidden="true">
                <TvIcon name="live" />
            </span>
        );
    // A 30×20 flag cropped to its centre square, then clipped round in CSS.
    return (
        <svg
            class="flag"
            viewBox="0 0 30 20"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
        >
            <Shape w={30} h={20} />
        </svg>
    );
}
