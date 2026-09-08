const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const HOST = '127.0.0.1';
const PORT = 8765;
const ROOT = path.join(__dirname, 'app');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendFile(filePath, response) {
  fs.stat(filePath, (statError, stats) => {
    if (
      statError ||
      !stats.isFile()
    ) {
      response.writeHead(
        404,
        {
          'Content-Type':
            'text/plain; charset=utf-8',
        },
      );

      response.end(
        'File not found.',
      );

      return;
    }

    const extension =
      path.extname(
        filePath,
      ).toLowerCase();

    response.writeHead(
      200,
      {
        'Content-Type':
          MIME_TYPES[
            extension
          ] ??
          'application/octet-stream',

        'Cache-Control':
          'no-store',

        /*
         * Keep local WebCodecs / worker behavior
         * predictable and prevent MIME sniffing.
         */
        'X-Content-Type-Options':
          'nosniff',
      },
    );

    fs.createReadStream(
      filePath,
    ).pipe(
      response,
    );
  });
}

const server =
  http.createServer(
    (request, response) => {
      try {
        const url =
          new URL(
            request.url ?? '/',
            `http://${HOST}:${PORT}`,
          );

        let pathname =
          decodeURIComponent(
            url.pathname,
          );

        if (
          pathname === '/'
        ) {
          pathname =
            '/index.html';
        }

        const requested =
          path.resolve(
            ROOT,
            `.${pathname}`,
          );

        /*
         * Never serve outside /app.
         */
        if (
          requested !== ROOT &&
          !requested.startsWith(
            `${ROOT}${path.sep}`,
          )
        ) {
          response.writeHead(
            403,
          );

          response.end(
            'Forbidden.',
          );

          return;
        }

        sendFile(
          requested,
          response,
        );
      } catch (
        error
      ) {
        console.error(
          error,
        );

        response.writeHead(
          500,
        );

        response.end(
          'Local server error.',
        );
      }
    },
  );

server.listen(
  PORT,
  HOST,
  () => {
    const address =
      `http://${HOST}:${PORT}/`;

    console.log(
      '',
    );

    console.log(
      'Barnes Maze Analyzer',
    );

    console.log(
      '====================',
    );

    console.log(
      `Running locally at ${address}`,
    );

    console.log(
      '',
    );

    console.log(
      'Video files remain on this computer.',
    );

    console.log(
      'Close this window when finished.',
    );

    console.log(
      '',
    );

    /*
     * Prefer Chrome, then Edge.
     *
     * Scientific validation found Firefox
     * unsuitable for quantitative analysis.
     */
    const command =
      `start "" chrome "${address}" ` +
      `|| start "" msedge "${address}" ` +
      `|| start "" "${address}"`;

    exec(
      command,
    );
  },
);

server.on(
  'error',
  (error) => {
    console.error(
      'Unable to start Barnes Maze Analyzer:',
      error,
    );

    console.log(
      '',
    );

    console.log(
      'Press Enter to close.',
    );

    process.stdin.resume();

    process.stdin.once(
      'data',
      () =>
        process.exit(
          1,
        ),
    );
  },
);