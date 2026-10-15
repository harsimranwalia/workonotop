// src/lib/read-capped-body.js
//
// Reads the body of a request without trusting what the request says about its size (ENG-016 design, Interfaces 7). A photo arrives as a
// multipart body, and request.formData() reads all of a body into memory before anything can say no; a Content-Length can be missing (a chunked
// body has none) or wrong, so the only count to trust is the one made on the bytes as they arrive.
//
// readCappedBody(request, maxBytes) -> { ok: true, bytes } | { ok: false }
//   bytes is a Buffer holding the whole body (empty when the request has none). ok is false as soon as the running total passes maxBytes: the
//   reader is cancelled at the chunk that crossed the line, so a stream that would run for ever is cut there, and nothing past it is read or kept.
//   A body of exactly maxBytes fits. A stream that fails part way (a client that went away) throws what it failed with, for the route's catch.
export async function readCappedBody(request, maxBytes) {
  if (!request.body) return { ok: true, bytes: Buffer.alloc(0) };

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { ok: true, bytes: Buffer.concat(chunks, total) };
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch((failed) => console.error('Error cancelling a body past its cap:', failed?.code || failed?.name));
      return { ok: false };
    }
    chunks.push(value);
  }
}
