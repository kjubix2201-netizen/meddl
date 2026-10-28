import { Injectable } from '@angular/core';
import { TmdbApiClient } from '@meddl/shared/tmdb';
export { TmdbApiError, isTmdbNotFound } from '@meddl/shared/tmdb';

@Injectable({ providedIn: 'root' })
export class TmdbApiService extends TmdbApiClient {
    constructor() {
        super();
    }
}
