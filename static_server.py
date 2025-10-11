# static_server.py
from flask import Blueprint, send_from_directory, abort, Response, current_app
from pathlib import Path

static_server_bp = Blueprint("static_server", __name__, url_prefix="/godot")

def add_coop_coep_headers(response: Response) -> Response:
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response

@static_server_bp.route("/", defaults={"filename": "index.html"})
@static_server_bp.route("/<path:filename>")
def serve_file(filename):
    static_root = Path(current_app.config.get("STATIC_ROOT", "./")).resolve()
    file_path = static_root / filename

    print(f"[static_server] Serving from: {static_root}")
    print(f"[static_server] Requested: {filename}")
    print(f"[static_server] Full path: {file_path}")

    if not file_path.exists():
        print("[static_server] ❌ File not found:", file_path)
        abort(404)

    response = send_from_directory(static_root, filename)
    return add_coop_coep_headers(response)
