import { IpcMainInvokeEvent, clipboard, shell } from "electron";
import { SettingsPresetJson } from "./@core/domain/settings_preset/settings_preset";
import { settingsController } from "./settings/settings.index";
import { ocrRecognitionController } from "./ocr_recognition/ocr_recognition.index";
import { overlayController } from "./overlay/overlay.index";
import { mainController } from "./main/main.index";
import { uIOhook } from 'uiohook-napi'
import { PpOcrAdapter } from "./@core/infra/ocr/ppocr.adapter/ppocr.adapter";
import { ipcMain } from "./common/ipc_main";

// Handlers used by multiple controllers

ipcMain.handle( 'ocr_recognition:restart_engine', async ( event: IpcMainInvokeEvent, engineName: string ) => {

    ocrRecognitionController.restartEngine( engineName );
});

ipcMain.handle( 'refresh_window', async ( event: IpcMainInvokeEvent, windowName: ('overlay' | 'main')[] ) => {
    if ( windowName.includes( 'overlay') )
        overlayController.refreshPage();

    if ( windowName.includes( 'main') )
        mainController.refreshPage();
});

ipcMain.handle( 'open_link', async ( event: IpcMainInvokeEvent, message: string ) => {

    // Only open web links. shell.openExternal can also launch local files,
    // programs and protocol handlers, which must never come from untrusted input.
    let link: URL;
    try {
        link = new URL( String(message) );
    } catch {
        return;
    }

    if ( link.protocol !== 'http:' && link.protocol !== 'https:' ) {
        console.warn(`open_link: blocked non-web URL "${message}"`);
        return;
    }

    shell.openExternal( link.href );
});