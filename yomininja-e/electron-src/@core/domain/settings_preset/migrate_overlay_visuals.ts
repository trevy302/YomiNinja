import { OverlayVisualCustomizations } from "./settings_preset_overlay";
import { OVERLAY_ACCENT } from "./overlay_theme";

const TRANSPARENT = '#00000000';

const sameColor = ( a: unknown, b: string ) =>
    typeof a === 'string' && a.trim().toLowerCase() === b;

// Moves a saved preset from the old red/black overlay look to the current defaults.
// Only values that still equal the old defaults are replaced, so customized colors are kept.
// Returns a new object; the input isn't modified.
export function migrateOverlayVisuals(
    visuals: OverlayVisualCustomizations | undefined
): OverlayVisualCustomizations | undefined {

    if ( !visuals ) return visuals;

    const result: OverlayVisualCustomizations = {
        ...visuals,
        frame: visuals.frame && { ...visuals.frame },
        ocr_item_box: visuals.ocr_item_box && {
            ...visuals.ocr_item_box,
            text: visuals.ocr_item_box.text && { ...visuals.ocr_item_box.text },
            selected_text: visuals.ocr_item_box.selected_text && { ...visuals.ocr_item_box.selected_text },
        },
        indicators: visuals.indicators && { ...visuals.indicators },
    };

    const { frame, ocr_item_box: box, indicators } = result;

    if ( frame ) {
        if ( sameColor( frame.border_color, '#e21212' ) ) {
            frame.border_color = OVERLAY_ACCENT;
            if ( frame.border_width === 1 )
                frame.border_width = 0;
        }
    }

    if ( box ) {
        if ( sameColor( box.background_color, '#000000' ) )
            box.background_color = TRANSPARENT;

        if ( sameColor( box.background_color_inactive, '#5b7eff00' ) )
            box.background_color_inactive = TRANSPARENT;

        if ( sameColor( box.inactive_border_color, '#e21212' ) )
            box.inactive_border_color = TRANSPARENT;

        if ( sameColor( box.active_border_color, '#e21212' ) )
            box.active_border_color = '#ffffff40';

        if ( box.text && sameColor( box.text.color, '#ffffff' ) )
            box.text.color = TRANSPARENT;

        if ( box.selected_text ) {
            if ( sameColor( box.selected_text.background_color, '#c50b0b' ) ) {
                box.selected_text.background_color = '#7aa2f766';
                if ( sameColor( box.selected_text.color, '#ffffff' ) )
                    box.selected_text.color = TRANSPARENT;
            }
        }
    }

    if ( indicators && sameColor( indicators.processing_icon_color, '#c50b0b' ) )
        indicators.processing_icon_color = OVERLAY_ACCENT;

    return result;
}
