import { CommonModule } from '@angular/common';
import {
    Component,
    computed,
    inject,
    input,
    output,
    ViewEncapsulation,
    ChangeDetectionStrategy,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    PREFERRED_REGION_OPTIONS,
    preferredRegionLabel,
} from '@meddl/shared/m3u-utils';
import { map, startWith } from 'rxjs';
import { CoverSize, Language, Theme } from '@meddl/shared/interfaces';
import {
    CoverSizeOption,
    StartupBehaviorOption,
    StartupWindowModeOption,
    ThemeOption,
} from './settings.models';
import { markSectionForCheckOnFormEvents } from './settings-section-form-render';
import {
    RadioGroupDirective,
    RadioOptionDirective,
} from '@meddl/ui/components/radio-group';
import { provideFormFieldDefaults } from '@meddl/ui/components/form-field-defaults';

@Component({
    selector: 'app-settings-general-section',
    providers: [provideFormFieldDefaults()],
    imports: [
        RadioGroupDirective,
        RadioOptionDirective,
        CommonModule,
        MatFormFieldModule,
        MatIconModule,
        MatSelectModule,
        MatSlideToggleModule,
        ReactiveFormsModule,
        TranslateModule,
    ],
    templateUrl: './settings-general-section.component.html',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [':host { display: contents; }'],
})
export class SettingsGeneralSectionComponent {
    readonly form = input.required<FormGroup>();

    constructor() {
        // Parent patches (Discard, backup import) change the form outside
        // this OnPush section's events.
        markSectionForCheckOnFormEvents(this.form);
    }

    readonly languageEnum = input.required<typeof Language>();
    readonly themeOptions = input.required<ThemeOption[]>();
    readonly coverSizeOptions = input.required<CoverSizeOption[]>();
    readonly startupBehaviorOptions = input.required<StartupBehaviorOption[]>();
    readonly startupWindowModeOptions =
        input.required<StartupWindowModeOption[]>();
    /** Desktop only: the window-mode select needs the main-process mirror and F11 */
    readonly supportsStartupWindowMode = input(false);
    readonly supportsPortalConnectivityGuard = input(false);

    private readonly translate = inject(TranslateService);
    private readonly appLanguage = toSignal(
        this.translate.onLangChange.pipe(
            map((event) => event.lang),
            startWith(this.translate.currentLang)
        )
    );
    /** Region names come from Intl, localized to the app language. */
    readonly preferredRegionOptions = computed(() =>
        PREFERRED_REGION_OPTIONS.map((option) => ({
            value: option.value,
            label: preferredRegionLabel(option.countries, this.appLanguage()),
        }))
    );

    readonly selectTheme = output<Theme>();
    readonly selectCoverSize = output<CoverSize>();
}
