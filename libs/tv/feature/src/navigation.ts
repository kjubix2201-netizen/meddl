import type { Kind, Media } from '@meddl/tv/util';
export type View =
    | 'home'
    | 'live'
    | 'movies'
    | 'series'
    | 'favorites'
    | 'search'
    | 'sources'
    | 'settings'
    | 'person'
    | 'detail';
export interface Route {
    view: View;
    kind: Kind;
    category: string;
    page: number;
    query: string;
    /** Live TV / Movies / Series: chosen country (ISO code, 'all' or
     * 'other'); '' shows the country picker first. */
    country: string;
    item?: Media;
    person?: { tmdbId: number; name: string; sourceId: string };
}
export const firstRoute = (): Route => ({
    view: 'home',
    kind: 'movie',
    category: '',
    page: 0,
    query: '',
    country: '',
});
