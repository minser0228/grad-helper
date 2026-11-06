# 개발용 정적 서버. 브라우저가 옛 rules.js·app.js를 캐시해 수정이 안 보이는 일을 막으려고 캐시를 끈다.
# 사용: python3 scripts/serve.py [포트]   (기본 8100, 8000은 axboard가 씀)
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8100
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    http.server.ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
