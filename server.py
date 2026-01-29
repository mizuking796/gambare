#!/usr/bin/env python3
"""
呼吸数推定アプリ用 簡易HTTPサーバー
ポート8080でlocalhostにサーバーを起動します

使い方:
    python server.py

ブラウザで http://localhost:8080 を開いてください
"""

import http.server
import socketserver

PORT = 8081

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # CORSヘッダーを追加（ローカル開発用）
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

if __name__ == '__main__':
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"サーバー起動: http://localhost:{PORT}")
        print("終了するには Ctrl+C を押してください")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nサーバーを停止しました")
