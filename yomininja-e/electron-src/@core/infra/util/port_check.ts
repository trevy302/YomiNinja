import net from 'net';


export async function isPortInUse( port: number, host = '0.0.0.0' ): Promise< boolean > {
    return new Promise(( resolve, reject ) => {
    
        const client = new net.Socket();
    
        client.connect( port, host, () => {
            resolve(true);
            client.end();
            client.destroy();
        });
    
        client.on('error', (err) => {
            resolve(false);
            client.end();
            client.destroy();
        });
    });
}

export async function isPortAvailable( port: number, host = '127.0.0.1' ): Promise< boolean > {
    return new Promise( (resolve, reject) => {

        const server = net.createServer((socket) => {
            socket.on( 'connect', () => socket.end() );
        });
    
        server.on( 'error', ( e ) => {
            console.log(e.message);
            server.close();
            resolve(false);
        });
      
        server.listen( port, host, () => {
            server.close();
            resolve(true);
        });
    });
}

export async function getNextPortAvailable( port: number, host = '127.0.0.1' ): Promise< number | undefined > {

    while( port < 65_535 ) {

        const isAvailable = await isPortAvailable( port, host );

        if ( isAvailable ) return port;

        port++;
    }

    return;
}