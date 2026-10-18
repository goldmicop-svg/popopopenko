"""Local game server with device-local accounts and owner moderation tools."""
from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import RLock
from datetime import datetime, timezone
from urllib.parse import unquote
import hashlib
import hmac
import json
import os
import re
import secrets


ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / ".local" / "users.json"
PORT = 8000
OWNER_SALT = bytes.fromhex("8ac7fda3f4f09e7c512430bf1bd1ce87")
OWNER_PASSWORD_HASH = "f36a17ade0f44bec97ac562cd6840c4271cc46ef8f35c21b5cbde2cb5e965c72"
lock = RLock()
sessions: dict[str, str] = {}


def password_hash(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000).hex()


def load_users() -> dict:
    try:
        return json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


users = load_users()
if "owner" not in users:
    users["owner"] = {
        "username": "owner", "salt": OWNER_SALT.hex(), "password_hash": OWNER_PASSWORD_HASH,
        "admin": True, "banned": False, "created": datetime.now(timezone.utc).isoformat(),
        "game": {"coins": 120, "unlocked": 1, "best": 0, "heroes": [0], "selectedHero": 0, "upgrades": {}, "volume": 45, "device": "pc", "mode": "levels", "caseWelcome": True},
    }


def save_users() -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = DATA_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(users, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, DATA_FILE)


save_users()


def public_user(record: dict) -> dict:
    return {"username": record["username"], "admin": bool(record.get("admin")), "banned": bool(record.get("banned")), "created": record.get("created"), "game": record.get("game", {})}


def safe_game_data(value: object) -> dict:
    if not isinstance(value, dict):
        return {}
    def number(name: str, default: float, minimum: float, maximum: float) -> float:
        try:
            return max(minimum, min(maximum, float(value.get(name, default))))
        except (TypeError, ValueError):
            return default
    heroes = value.get("heroes", [0])
    if not isinstance(heroes, list):
        heroes = [0]
    heroes = sorted({int(item) for item in heroes if str(item).isdigit() and 0 <= int(item) < 18})
    upgrades = value.get("upgrades", {})
    if not isinstance(upgrades, dict):
        upgrades = {}
    clean_upgrades = {str(int(k)): int(max(0, min(5, int(v)))) for k, v in upgrades.items() if str(k).isdigit() and str(v).isdigit() and int(k) < 18}
    device = "phone" if value.get("device") == "phone" else "pc"
    return {
        "coins": int(number("coins", 0, 0, 2_000_000_000)),
        "unlocked": int(number("unlocked", 1, 1, 20)),
        "best": int(number("best", 0, 0, 1_000_000)),
        "heroes": heroes or [0],
        "selectedHero": int(number("selectedHero", 0, 0, 17)),
        "upgrades": clean_upgrades,
        "volume": int(number("volume", 45, 0, 100)),
        "device": device,
        "mode": "arcade" if value.get("mode") == "arcade" else "levels",
        "caseWelcome": bool(value.get("caseWelcome", True)),
    }


class GameHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        # Keep ordinary game play from filling the terminal with access logs.
        return

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 65536:
            raise ValueError("Слишком большой запрос")
        data = json.loads(self.rfile.read(length) or b"{}")
        if not isinstance(data, dict):
            raise ValueError("Ожидался JSON-объект")
        return data

    def current_user(self) -> tuple[str, dict] | tuple[None, None]:
        auth = self.headers.get("Authorization", "")
        token = auth.removeprefix("Bearer ")
        username = sessions.get(token)
        record = users.get(username) if username else None
        if not record or record.get("banned"):
            return None, None
        return username, record

    def require_user(self):
        username, record = self.current_user()
        if not record:
            self.send_json(403, {"error": "Сессия завершена или аккаунт заблокирован. Войди снова."})
            return None, None
        return username, record

    def do_GET(self):
        safe_path = unquote(self.path.split("?", 1)[0]).replace("\\", "/")
        if safe_path.startswith("/.local"):
            self.send_json(404, {"error": "Не найдено"})
            return
        if self.path == "/api/me":
            username, record = self.require_user()
            if record:
                self.send_json(200, {"user": public_user(record)})
            return
        if self.path == "/api/admin/users":
            username, record = self.require_user()
            if record:
                if not record.get("admin"):
                    self.send_json(403, {"error": "Доступ только для owner"})
                    return
                with lock:
                    listing = [public_user(row) for row in users.values()]
                self.send_json(200, {"users": listing})
            return
        if self.path.startswith("/api/"):
            self.send_json(404, {"error": "Маршрут не найден"})
            return
        super().do_GET()

    def do_POST(self):
        try:
            body = self.read_json()
        except (ValueError, json.JSONDecodeError):
            self.send_json(400, {"error": "Некорректный запрос"})
            return

        if self.path in ("/api/register", "/api/login"):
            username = str(body.get("username", "")).strip().lower()
            password = str(body.get("password", ""))
            if self.path == "/api/register":
                if not re.fullmatch(r"[a-z0-9_-]{3,20}", username):
                    self.send_json(400, {"error": "Логин: 3–20 символов, латинские буквы, цифры, _ или -."})
                    return
                if len(password) < 6 or len(password) > 80:
                    self.send_json(400, {"error": "Пароль должен быть длиной от 6 до 80 символов."})
                    return
                with lock:
                    if username in users:
                        self.send_json(409, {"error": "Этот логин уже занят."})
                        return
                    salt = secrets.token_bytes(16)
                    users[username] = {"username": username, "salt": salt.hex(), "password_hash": password_hash(password, salt), "admin": False, "banned": False, "created": datetime.now(timezone.utc).isoformat(), "game": {"coins": 120, "unlocked": 1, "best": 0, "heroes": [0], "selectedHero": 0, "upgrades": {}, "volume": 45, "device": "pc", "mode": "levels", "caseWelcome": True}}
                    save_users()
                    record = users[username]
            else:
                record = users.get(username)
                if not record or not hmac.compare_digest(password_hash(password, bytes.fromhex(record["salt"])), record["password_hash"]):
                    self.send_json(401, {"error": "Неверный логин или пароль."})
                    return
                if record.get("banned"):
                    self.send_json(403, {"error": "Этот аккаунт заблокирован владельцем игры."})
                    return
            token = secrets.token_urlsafe(32)
            sessions[token] = username
            self.send_json(200, {"token": token, "user": public_user(record)})
            return

        username, record = self.require_user()
        if not record:
            return
        if self.path == "/api/logout":
            token = self.headers.get("Authorization", "").removeprefix("Bearer ")
            sessions.pop(token, None)
            self.send_json(200, {"ok": True})
            return
        if self.path == "/api/save":
            with lock:
                incoming = safe_game_data(body.get("game"))
                if incoming:
                    record["game"] = incoming
                    save_users()
            self.send_json(200, {"game": record.get("game", {})})
            return
        if self.path == "/api/admin/action":
            if not record.get("admin"):
                self.send_json(403, {"error": "Доступ только для owner"})
                return
            action, target = body.get("action"), str(body.get("target", "")).strip().lower()
            with lock:
                target_record = users.get(target)
                if not target_record:
                    self.send_json(404, {"error": "Игрок не найден"})
                    return
                if action == "ban":
                    if target == "owner":
                        self.send_json(400, {"error": "Аккаунт owner нельзя заблокировать"})
                        return
                    target_record["banned"] = True
                elif action == "unban":
                    target_record["banned"] = False
                elif action == "adjust_coins":
                    try:
                        amount = int(body.get("amount", 0))
                    except (TypeError, ValueError):
                        amount = 0
                    game = target_record.setdefault("game", {})
                    game["coins"] = max(0, min(2_000_000_000, int(game.get("coins", 0)) + amount))
                elif action == "grant_hero":
                    try:
                        hero_id = int(body.get("heroId"))
                    except (TypeError, ValueError):
                        hero_id = -1
                    if not 0 <= hero_id < 18:
                        self.send_json(400, {"error": "Неизвестный персонаж"})
                        return
                    game = target_record.setdefault("game", {})
                    owned = game.setdefault("heroes", [0])
                    if hero_id not in owned:
                        owned.append(hero_id)
                else:
                    self.send_json(400, {"error": "Неизвестное действие"})
                    return
                save_users()
                result = public_user(target_record)
            self.send_json(200, {"user": result})
            return
        self.send_json(404, {"error": "Маршрут не найден"})


if __name__ == "__main__":
    os.chdir(ROOT)
    print(f"Игра открыта: http://localhost:{PORT}")
    print("Учётные записи и прогресс хранятся в user-data.json")
    ThreadingHTTPServer(("127.0.0.1", PORT), GameHandler).serve_forever()
