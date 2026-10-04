"""Serve the Foreman homepage locally: python3 site/serve.py, then open http://127.0.0.1:5320/"""

import functools
import http.server
import os

PORT = 5320
HERE = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    handler = functools.partial(Handler, directory=HERE)
    with http.server.ThreadingHTTPServer(('127.0.0.1', PORT), handler) as srv:
        print(f'Foreman homepage at http://127.0.0.1:{PORT}/')
        srv.serve_forever()
