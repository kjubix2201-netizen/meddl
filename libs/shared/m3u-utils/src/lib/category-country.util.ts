import { regionTokens } from './preferred-region.util';

/**
 * Country a category / group name is tagged with ("DE | Sport" → "DE",
 * "|UK| News" → "GB", "FRANCE HD" → "FR"), as an ISO 3166-1 alpha-2 code,
 * or null. Used for flags in channel category lists.
 *
 * Same matching rules as the preferred region: upper-case tags only (so the
 * Spanish/French word "de" never means Germany), country words in any case
 * and without accents. Short tags only count among the first two tokens,
 * where providers put them ("|DE| Sport", "4K-DE"), so English words in a
 * title ("MADE IN GERMANY", "NO SIGNAL") are not read as India or Norway.
 */
const TAGS: Readonly<Record<string, string>> = {
    DE: 'DE', GER: 'DE', DEU: 'DE',
    AT: 'AT', AUT: 'AT',
    CH: 'CH', SUI: 'CH',
    UK: 'GB', GB: 'GB', GBR: 'GB',
    US: 'US', USA: 'US',
    FR: 'FR', FRA: 'FR',
    IT: 'IT', ITA: 'IT',
    ES: 'ES', ESP: 'ES',
    NL: 'NL', NLD: 'NL',
    BE: 'BE', BEL: 'BE',
    PL: 'PL', POL: 'PL',
    TR: 'TR', TUR: 'TR',
    PT: 'PT', POR: 'PT',
    GR: 'GR', GRE: 'GR',
    RO: 'RO', ROU: 'RO',
    AL: 'AL', ALB: 'AL',
    HR: 'HR', CRO: 'HR',
    RS: 'RS', SRB: 'RS',
    BA: 'BA',
    BG: 'BG', BGR: 'BG',
    HU: 'HU', HUN: 'HU',
    CZ: 'CZ',
    SK: 'SK',
    SE: 'SE', SWE: 'SE',
    NOR: 'NO', // not "NO": English word
    DK: 'DK', DEN: 'DK',
    FI: 'FI', FIN: 'FI',
    IE: 'IE', IRL: 'IE',
    RU: 'RU', RUS: 'RU',
    UA: 'UA', UKR: 'UA',
    IND: 'IN', // not "IN": English word
    PK: 'PK',
    BR: 'BR', BRA: 'BR',
    MX: 'MX', MEX: 'MX',
    CA: 'CA', CAN: 'CA',
    AU: 'AU', AUS: 'AU',
};

const WORDS: Readonly<Record<string, string>> = {
    GERMANY: 'DE', GERMAN: 'DE', DEUTSCH: 'DE', DEUTSCHLAND: 'DE',
    AUSTRIA: 'AT', OSTERREICH: 'AT', OESTERREICH: 'AT',
    SWITZERLAND: 'CH', SCHWEIZ: 'CH', SWISS: 'CH',
    ENGLAND: 'GB', BRITISH: 'GB',
    AMERICA: 'US', AMERICAN: 'US',
    FRANCE: 'FR', FRENCH: 'FR', FRANCAIS: 'FR',
    ITALY: 'IT', ITALIA: 'IT', ITALIAN: 'IT',
    SPAIN: 'ES', ESPANA: 'ES', SPANISH: 'ES',
    NETHERLANDS: 'NL', NEDERLAND: 'NL', DUTCH: 'NL', HOLLAND: 'NL',
    BELGIUM: 'BE', BELGIE: 'BE', BELGIQUE: 'BE',
    POLAND: 'PL', POLSKA: 'PL', POLISH: 'PL',
    TURKEY: 'TR', TURKIYE: 'TR', TURKISH: 'TR',
    PORTUGAL: 'PT', PORTUGUESE: 'PT',
    GREECE: 'GR', GREEK: 'GR',
    ROMANIA: 'RO',
    ALBANIA: 'AL', SHQIP: 'AL',
    CROATIA: 'HR', HRVATSKA: 'HR',
    SERBIA: 'RS', SRBIJA: 'RS',
    BULGARIA: 'BG',
    HUNGARY: 'HU', MAGYAR: 'HU',
    SWEDEN: 'SE', SVERIGE: 'SE',
    NORWAY: 'NO', NORGE: 'NO',
    DENMARK: 'DK', DANMARK: 'DK',
    FINLAND: 'FI', SUOMI: 'FI',
    IRELAND: 'IE',
    RUSSIA: 'RU',
    UKRAINE: 'UA',
    INDIA: 'IN',
    PAKISTAN: 'PK',
    BRAZIL: 'BR', BRASIL: 'BR',
    MEXICO: 'MX',
    CANADA: 'CA',
    AUSTRALIA: 'AU',
};

export function categoryCountry(name: string | null | undefined): string | null {
    if (!name) return null;
    const tokens = regionTokens(name);
    const upper = tokens.map((token) => token.toUpperCase());
    // Country words win anywhere ("MADE IN GERMANY"), then a leading tag.
    for (let index = 0; index < upper.length; index++) {
        const word = WORDS[upper[index]];
        if (word) return word;
        const pair = `${upper[index]} ${upper[index + 1] ?? ''}`;
        if (pair === 'UNITED KINGDOM') return 'GB';
        if (pair === 'UNITED STATES') return 'US';
    }
    for (const token of tokens.slice(0, 2)) {
        const tag = TAGS[token.replace(/\+$/, '')];
        if (tag) return tag;
    }
    return null;
}
