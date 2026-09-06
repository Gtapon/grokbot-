# YachiCut MVP

Local AI-operable video editor MVP.

See package.json scripts: install, start, dev, cli, mcp, demo.

## Features

- shots tracks clips decisions hashes
- Web UI CLI MCP
- MockGenerationProvider ffmpeg
- Export JSON and timeline

## CLI

npm run cli -- doctor
npm run cli -- create MyCut
npm run cli -- add-shot -p ID -t Opening --duration 2
npm run cli -- generate-clip -p ID -s SHOT
npm run cli -- accept -p ID --shot SHOT
npm run cli -- status -p ID
npm run cli -- export -p ID
npm run demo

## Run UI

npm run start
npm run dev

API on 8787, UI on 5173 (proxies /api).

## MCP

npm run mcp

Point your MCP client at tsx src/mcp/server.ts with cwd = this folder.

## Future

ComfyUI provider, NLE writers (Resolve/Premiere/CapCut), auth/cloud.

## License

MIT

## Install

npm install
# or: bun install (bun.lock included)

ffmpeg recommended for mock MP4 generation and timeline concat.
