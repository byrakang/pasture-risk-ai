import os
from waitress import serve
from app import app
 
if __name__ == "__main__":
    host, port = os.environ.get("HOST", "0.0.0.0"), int(os.environ.get("PORT", "5000"))
    print(f"Сайт ажиллаж байна: http://127.0.0.1:{port}  (Зогсоох: Ctrl+C)")
    serve(app, host=host, port=port)
 