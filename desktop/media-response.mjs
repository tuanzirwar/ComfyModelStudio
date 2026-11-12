import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';

const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif' };

// Electron net.fetch(file:) puts the unescaped filename in a response header.
// Chinese automation output names then throw inside Electron's Headers.set.
// The caller has already checked that this is an authorized model/output path.
export async function mediaResponse(file) {
  try {
    const info = await stat(file);
    if (!info.isFile()) return new Response(null, { status: 404 });
    const stream = Readable.toWeb(createReadStream(file));
    return new Response(stream, { headers: { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': String(info.size), 'Cache-Control': 'no-cache' } });
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return new Response(null, { status: 404 });
    throw error;
  }
}
