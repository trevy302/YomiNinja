import { GetActiveSettingsPresetUseCase } from "../@core/application/use_cases/get_active_settings_preset/get_active_settings_preset.use_case";
import { GetSupportedLanguagesUseCase } from "../@core/application/use_cases/get_supported_languages/get_supported_languages.use_case";
import { getActiveProfile } from "../@core/infra/app_initialization";

import { WebSocketServer, WebSocket } from 'ws';



export class OverlayService {
    
    private getActiveSettingsPresetUseCase: GetActiveSettingsPresetUseCase;

    private webSocketServer: WebSocketServer;
    private wsConnections: WebSocket[] = [];

    constructor( input: {        
        getActiveSettingsPresetUseCase: GetActiveSettingsPresetUseCase,
    }){        
        this.getActiveSettingsPresetUseCase = input.getActiveSettingsPresetUseCase;
    }

    // Websocket to use with text extractors
    initWebSocket() {

        // Texthooker pages are hosted on other origins, so origins aren't restricted here;
        // this socket only broadcasts OCR text. Keep it off the local network, though.
        this.webSocketServer = new WebSocketServer({ port: 6677, host: '127.0.0.1' });

        this.webSocketServer.on( 'connection', ( ws ) => {

            ws.on( 'error', console.error );            
            
            console.log("New socket connection!");
            this.wsConnections.push( ws );
        });
    }

    async getActiveSettingsPreset() {
        return await this.getActiveSettingsPresetUseCase.execute({
            profileId: getActiveProfile().id
        });
    }

    sendOcrTextTroughWS( text: string ) {

        this.wsConnections.forEach( ws => {
            ws.send(text);
        });
    }
}