/**
 * Cleaner names for the Live TV lists. Providers prefix categories and
 * channels with the country and a symbol ("|DE| ✪ SPORT", "DE - ZDF HD"),
 * which repeats on every row inside a country, and often write them in
 * capitals. Display only: search, sorting and saved data keep the original.
 */
// "|DE|", "[DE]", "(DE)" or "DE -", "DE:", "DE |", then an optional symbol.
const PREFIX = /^\s*(?:[|[(]\s*[A-Z]{2,3}\s*[|\])]|[A-Z]{2,3}\s*[-–:|])\s*(?:[✪★☆●◉•·♦◆|]\s*)?/;
const QUALITY = /\s*(?:\b(?:UHD|FHD|HD|SD|4K|8K|HEVC|H\.?265|RAW|1080P|720P|2160P)\b\+?\s*)+$/i;
// Capitals that stay capitals: channel brands and short words.
const KEEP = new Set(
    'TV HD UHD FHD SD ZDF ARD RTL ORF SRF DAZN MTV NBA NFL NHL UFC PPV VOD BBC CNN DMAX SAT KIKA UEFA DFB F1 USA UK DE AT CH TRT ATV NDR WDR MDR SWR BR HR RBB SR N24 NTV'.split(' ')
);

function softCase(text: string): string {
    // Only names written entirely in capitals are softened.
    if (/[a-zäöüß]/.test(text)) return text;
    return text.replace(/[A-ZÄÖÜ][A-ZÄÖÜ0-9']+/g, (word) =>
        KEEP.has(word) || word.length <= 2 ? word : word[0] + word.slice(1).toLowerCase()
    );
}

function stripPrefix(text: string): string {
    const stripped = text.replace(PREFIX, '').trim();
    return stripped.length >= 2 ? stripped : text.trim();
}

/** "|DE| ✪ SKY CINEMA" → "Sky Cinema". */
export function displayCategoryName(name: string): string {
    return softCase(stripPrefix(name)).replace(/\s*\|\s*/g, ' · ');
}

/** "DE - PROMI BIG BROTHER HD" → "Promi Big Brother" (quality shows as a badge). */
export function displayChannelName(title: string): string {
    const name = stripPrefix(title).replace(QUALITY, '').trim();
    return softCase(name.length >= 2 ? name : title.trim());
}
