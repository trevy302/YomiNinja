const fs = require('fs');

// Proto files
fs.cpSync(
    '../ocr_services/protos',
    './main/grpc/protos',
    { recursive: true }
);

// Generated Google Lens protobuf code (see `npm run grpc-lens-types`).
// tsc doesn't emit it because it's a .js file, but the Lens adapter requires it at runtime.
fs.cpSync(
    './grpc/rpc/lens/lens_pb.js',
    './main/grpc/rpc/lens/lens_pb.js'
);