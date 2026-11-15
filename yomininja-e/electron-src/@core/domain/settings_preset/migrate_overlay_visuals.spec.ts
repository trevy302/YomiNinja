import { migrateOverlayVisuals } from "./migrate_overlay_visuals";
import { getDefaultSettingsPresetProps, OVERLAY_ACCENT } from "./default_settings_preset_props";
import { OverlayVisualCustomizations } from "./settings_preset_overlay";
import { cloneDeep } from "lodash";

// The overlay visuals as they were saved before the cleanup
function oldDefaultVisuals(): OverlayVisualCustomizations {
    const visuals = cloneDeep( getDefaultSettingsPresetProps().overlay.visuals );
    visuals.frame = { border_color: '#e21212', border_width: 1 };
    visuals.ocr_item_box.background_color = '#000000';
    visuals.ocr_item_box.background_color_inactive = '#5b7eff00';
    visuals.ocr_item_box.inactive_border_color = '#e21212';
    visuals.ocr_item_box.active_border_color = '#E21212';
    visuals.ocr_item_box.text.color = '#ffffff';
    visuals.ocr_item_box.selected_text = { color: '#ffffff', background_color: '#c50b0b' };
    visuals.indicators.processing_icon_color = '#c50b0b';
    return visuals;
}

describe( 'migrateOverlayVisuals', () => {

    it( 'replaces the old defaults with the current ones', () => {
        const migrated = migrateOverlayVisuals( oldDefaultVisuals() );
        expect( migrated ).toStrictEqual( getDefaultSettingsPresetProps().overlay.visuals );
    });

    it( 'keeps customized values', () => {
        const visuals = oldDefaultVisuals();
        visuals.frame = { border_color: '#00ff00', border_width: 3 };
        visuals.ocr_item_box.background_color = '#222222cc';
        visuals.ocr_item_box.text.color = '#ffee00';
        visuals.ocr_item_box.selected_text = { color: '#ffffff', background_color: '#123456' };

        const migrated = migrateOverlayVisuals( visuals );

        expect( migrated?.frame ).toStrictEqual({ border_color: '#00ff00', border_width: 3 });
        expect( migrated?.ocr_item_box.background_color ).toBe( '#222222cc' );
        expect( migrated?.ocr_item_box.text.color ).toBe( '#ffee00' );
        expect( migrated?.ocr_item_box.selected_text ).toStrictEqual({ color: '#ffffff', background_color: '#123456' });
        // Untouched old defaults are still migrated
        expect( migrated?.ocr_item_box.inactive_border_color ).toBe( '#00000000' );
    });

    it( 'keeps a custom frame width when only the color is the old default', () => {
        const visuals = oldDefaultVisuals();
        visuals.frame.border_width = 4;
        const migrated = migrateOverlayVisuals( visuals );
        expect( migrated?.frame ).toStrictEqual({ border_color: OVERLAY_ACCENT, border_width: 4 });
    });

    it( 'does not modify its input', () => {
        const visuals = oldDefaultVisuals();
        const copy = cloneDeep( visuals );
        migrateOverlayVisuals( visuals );
        expect( visuals ).toStrictEqual( copy );
    });

    it( 'leaves current defaults unchanged', () => {
        const visuals = getDefaultSettingsPresetProps().overlay.visuals;
        expect( migrateOverlayVisuals( visuals ) ).toStrictEqual( visuals );
    });

    it( 'handles missing visuals', () => {
        expect( migrateOverlayVisuals( undefined ) ).toBeUndefined();
    });
});
