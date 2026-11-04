"""Local provider list. The file stays outside the world and out of git."""
import json
import os
from pathlib import Path
import sys
import uuid

try:
    from .adapter import Config, ModelError
except ImportError:  # direct script execution
    from adapter import Config, ModelError

MAX_PROVIDERS = 32
MAX_FILE_BYTES = 256 * 1024
FIELDS = ('id', 'name', 'base_url', 'model', 'api_key')
TEXT_LIMITS = {'id': 64, 'name': 80, 'base_url': 500, 'model': 200, 'api_key': 4096}


class ProviderConfigError(Exception):
    """Safe code only. The message never includes file contents or credentials."""
    def __init__(self, code):
        super().__init__(code)


def config_file(env=None):
    env = os.environ if env is None else env
    base = env.get('XDG_CONFIG_HOME')
    if not base:
        home = env.get('HOME')
        if not home:
            return None
        base = str(Path(home) / '.config')
    return Path(base) / 'wispiva' / 'providers.json'


def empty_store():
    return {'selected': None, 'providers': []}


def new_provider():
    return {'id': uuid.uuid4().hex, 'name': '', 'base_url': '', 'model': '', 'api_key': ''}


def load_store(env=None):
    path = config_file(env)
    if path is None or not path.exists():
        return empty_store()
    return _read(path)


def save_store(store, env=None):
    path = config_file(env)
    if path is None:
        raise ProviderConfigError('unreadable')
    cleaned = _validate(store)
    directory = path.parent
    # A symlinked directory would write the credential file somewhere else.
    if directory.is_symlink() or path.is_symlink():
        raise ProviderConfigError('unreadable')
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    temporary = directory / ('.providers-' + uuid.uuid4().hex + '.tmp')
    payload = json.dumps(cleaned, ensure_ascii=False, indent=2) + '\n'
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            out.write(payload)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        temporary.unlink(missing_ok=True)
    return cleaned


def write_status(path, code):
    """Write a short result code. Never write the provider document here."""
    if code not in ("ok", "missing_name", "incomplete", "bad_url", "invalid_store", "unreadable"):
        code = "invalid_store"
    target = Path(path)
    if target.is_symlink() or target.parent.is_symlink():
        return
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = target.with_name(".provider-status-" + uuid.uuid4().hex + ".tmp")
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            out.write(code + "\n")
        os.replace(temporary, target)
        os.chmod(target, 0o600)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    """Save one provider document from stdin. The status file receives only a code."""
    code = "ok"
    try:
        raw = sys.stdin.read(MAX_FILE_BYTES + 1)
        if len(raw) > MAX_FILE_BYTES:
            raise ProviderConfigError("invalid_store")
        save_store(json.loads(raw))
    except ProviderConfigError as exc:
        code = str(exc)
    except (json.JSONDecodeError, UnicodeError, OSError):
        code = "invalid_store"
    status = os.environ.get("WISPIVA_PROVIDER_STATUS") or ""
    if status:
        write_status(status, code)
    return 0 if code == "ok" else 2


def load_config(env=None):
    """Use the selected local provider. Without one, use the Actions environment slot."""
    env = os.environ if env is None else env
    path = config_file(env)
    if path is not None and path.exists():
        try:
            store = _read(path)
        except ProviderConfigError:
            raise ModelError('invalid_config') from None
        selected = store.get('selected')
        if selected:
            match = next((item for item in store['providers'] if item['id'] == selected), None)
            if match is None:
                return Config.from_values('', '', '')
            return Config.from_values(match['base_url'], match['model'], match['api_key'])
    return Config.from_env(env)


def _read(path):
    if path.is_symlink() or path.parent.is_symlink():
        raise ProviderConfigError('unreadable')
    try:
        info = path.stat()
        if info.st_size > MAX_FILE_BYTES:
            raise ProviderConfigError('unreadable')
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, UnicodeError, json.JSONDecodeError, ProviderConfigError):
        raise ProviderConfigError('unreadable') from None
    if not isinstance(data, dict):
        raise ProviderConfigError('unreadable')
    providers = data.get('providers')
    selected = data.get('selected', None)
    if not isinstance(providers, list) or len(providers) > MAX_PROVIDERS:
        raise ProviderConfigError('unreadable')
    if selected is not None and not isinstance(selected, str):
        raise ProviderConfigError('unreadable')
    cleaned = []
    seen = set()
    for item in providers:
        if not isinstance(item, dict):
            raise ProviderConfigError('unreadable')
        record = {}
        for key in FIELDS:
            value = item.get(key, '')
            if not isinstance(value, str) or len(value) > TEXT_LIMITS[key]:
                raise ProviderConfigError('unreadable')
            record[key] = value
        if not record['id'] or record['id'] in seen:
            raise ProviderConfigError('unreadable')
        seen.add(record['id'])
        cleaned.append(record)
    if selected is not None and selected not in seen:
        raise ProviderConfigError('unreadable')
    return {'selected': selected, 'providers': cleaned}


def _validate(store):
    if not isinstance(store, dict):
        raise ProviderConfigError('invalid_store')
    providers = store.get('providers')
    selected = store.get('selected', None)
    if not isinstance(providers, list) or len(providers) > MAX_PROVIDERS:
        raise ProviderConfigError('invalid_store')
    if selected is not None and not isinstance(selected, str):
        raise ProviderConfigError('invalid_store')
    cleaned = []
    seen = set()
    for item in providers:
        if not isinstance(item, dict):
            raise ProviderConfigError('invalid_store')
        record = {}
        for key in FIELDS:
            value = item.get(key, '')
            if not isinstance(value, str) or len(value) > TEXT_LIMITS[key]:
                raise ProviderConfigError('invalid_store')
            record[key] = value.strip() if key != 'api_key' else value
        if not record['id'] or record['id'] in seen:
            raise ProviderConfigError('invalid_store')
        seen.add(record['id'])
        if not record['name']:
            raise ProviderConfigError('missing_name')
        cleaned.append(record)
    if selected is not None and selected not in seen:
        raise ProviderConfigError('invalid_store')
    if selected is not None:
        chosen = next(item for item in cleaned if item['id'] == selected)
        if not chosen['base_url'] or not chosen['model'] or not chosen['api_key']:
            raise ProviderConfigError('incomplete')
        try:
            Config.from_values(chosen['base_url'], chosen['model'], chosen['api_key']).endpoint()
        except ModelError:
            raise ProviderConfigError('bad_url') from None
    return {'selected': selected, 'providers': cleaned}


if __name__ == "__main__":
    sys.exit(main())
