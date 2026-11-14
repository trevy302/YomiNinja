import http from 'http';
import url from "url";
import { Server } from 'socket.io';
import isDev from 'electron-is-dev';
import { getNextPortAvailable } from '../@core/infra/util/port_check';
import fs from 'fs';
import path from 'path';
import { PAGES_DIR } from '../util/directories.util';
import mimeTypes from 'mime-types';
import { customBrowserExtensionsAPI } from '../extensions/custom_browser_extensions_api/browser/api/browser_api';
import { appController } from '../app/app.index';
import { isLinux, httpServerPort, setHttpServerPort } from '../util/environment.util';

// The server is only meant to be reached from this machine.
export const LOCAL_SERVER_HOST = '127.0.0.1';

const LOOPBACK_HOSTNAMES = new Set([ 'localhost', '127.0.0.1', '[::1]' ]);

function getHostname( value: string ): string | undefined {
    try {
        return new URL( value ).hostname;
    } catch {
        return;
    }
}

// The Host header must name this machine. Blocks DNS rebinding attacks.
function isLoopbackHost( host?: string ): boolean {
    if ( !host ) return false;
    const hostname = getHostname( `http://${host}` );
    return Boolean( hostname && LOOPBACK_HOSTNAMES.has( hostname ) );
}

// Browsers always send an Origin header on cross-site requests and WebSocket handshakes,
// so this keeps arbitrary websites from driving the app, while still allowing:
// - YomiNinja's own pages (served from localhost)
// - extensions running inside YomiNinja (chrome-extension://)
// - non-browser clients on this machine (no Origin header)
export function isTrustedOrigin( origin?: string ): boolean {
    if ( !origin ) return true;
    if ( origin.startsWith( 'chrome-extension://' ) ) return true;
    const hostname = getHostname( origin );
    return Boolean( hostname && LOOPBACK_HOSTNAMES.has( hostname ) );
}

function isTrustedRequest( req: http.IncomingMessage ): boolean {
    return isLoopbackHost( req.headers.host ) &&
        isTrustedOrigin( req.headers.origin );
}

export let httpServer = http.createServer( async (req, res) => {

    if ( !isTrustedRequest( req ) ) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }

    const parsedUrl = url.parse( String(req?.url), true )

    const pagesRoot = path.resolve( isDev ? './renderer/out' : PAGES_DIR );

    let filePath = req.url === '/' ? '/index.html' : String(req.url);
    filePath = path.resolve(
      path.join( pagesRoot, filePath || '' )
    );

    // Never serve files outside the pages directory (e.g. "/../../secret.txt")
    if ( !filePath.startsWith( pagesRoot + path.sep ) ) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }

    if ( req.method === "POST" ) {
        if ( parsedUrl.pathname?.includes('chrome-api') ) {
            await customBrowserExtensionsAPI.router(
                parsedUrl,
                req,
                res
            );
            return;
        }
    }
    else if ( req.method === 'GET' ) {
        if ( parsedUrl.pathname?.includes('/remote-control') ) {
            appController.remoteControlRouter( parsedUrl );
            res.end();
            return;
        }
    }
  
    fs.access( filePath, fs.constants.F_OK, (err) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File not found');
        } else {
            
            fs.readFile( filePath, (err, data) => {
                if (err) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Internal server error');
                } else {
                    const contentType = mimeTypes.lookup(
                        path.extname(filePath)
                    );

                    if ( contentType )
                        res.writeHead(200, { 'Content-Type': contentType });
                    else
                        res.writeHead(200);

                    res.end(data);
                }
            });
        }
    });
});

export let socketServer = new Server( httpServer, {
    cors: {
        origin: ( origin, callback ) => callback( null, isTrustedOrigin( origin ) ),
        methods: ["GET", "POST"]
    },
    // Every IPC handler is reachable through this socket, so reject untrusted clients
    // before the connection is established (CORS alone doesn't apply to WebSockets).
    allowRequest: ( req, callback ) => {
        callback( null, isTrustedRequest( req ) );
    }
});

getNextPortAvailable( httpServerPort, LOCAL_SERVER_HOST )
    .then( port => {
        setHttpServerPort( port || httpServerPort - 1 );
        console.log("\nHTTP Server port: "+httpServerPort);
        httpServer.listen( httpServerPort, LOCAL_SERVER_HOST );
    });