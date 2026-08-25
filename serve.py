#!/usr/bin/env python3
"""Local dev server for Coffee Map.

Identical to `python3 -m http.server`, except it tells the browser never to cache.
Without that, editing a JS module and reloading can silently keep running the old
copy, which looks exactly like a code bug.

    python3 serve.py [port]        # default 8842
"""
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def log_message(self, fmt, *args):        # keep the console quiet
        if '404' in (fmt % args):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8842
    print(f'Coffee Map: http://127.0.0.1:{port}  (Ctrl-C to stop)')
    HTTPServer(('127.0.0.1', port), NoCacheHandler).serve_forever()
