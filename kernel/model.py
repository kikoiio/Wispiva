"""Optional chat client for the provider selected in the local Wispiva config."""

from __future__ import annotations

import json
import os
import shlex
import urllib.error
import urllib.request
from pathlib import Path


def provider_status() -> dict:
    try:
        provider = load_provider()
    except (ValueError, OSError):
        return {"configured": False, "model": "", "error": "模型配置无法读取或不完整"}
    if provider is None:
        return {"configured": False, "model": ""}
    return {"configured": True, "model": provider["model"]}


def load_provider() -> dict | None:
    fields = {"base_url": "WISPIVA_LLM_BASE_URL", "model": "WISPIVA_LLM_MODEL", "api_key": "WISPIVA_LLM_API_KEY"}
    file = Path(os.environ.get("WISPIVA_ENV_FILE") or Path(__file__).resolve().parents[1] / ".env")
    values = {}
    if os.environ.get("WISPIVA_ENV_FILE") and not file.is_file():
        raise ValueError("指定的模型配置文件不存在")
    if file.is_file():
        for line in file.read_text(encoding="utf-8").splitlines():
            line = line.strip().removeprefix("export ")
            key, separator, value = line.partition("=")
            if separator and key.strip() in fields.values():
                parts = shlex.split(value, comments=True)
                values[key.strip()] = " ".join(parts)
    chosen = {key: os.environ.get(env, values.get(env, "")) for key, env in fields.items()}
    if any(chosen.values()):
        if not all(chosen.values()):
            raise ValueError("模型配置需要同时设置服务地址、模型名和密钥")
        chosen["base_url"] = chosen["base_url"].rstrip("/")
        return chosen
    root = os.environ.get("XDG_CONFIG_HOME")
    base = Path(root) if root else Path.home() / ".config"
    path = base / "wispiva" / "providers.json"
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("模型配置必须为对象")
    selected = data.get("selected")
    providers = data.get("providers") or []
    if not isinstance(providers, list) or any(not isinstance(item, dict) for item in providers):
        raise ValueError("providers 必须为模型配置对象列表")
    chosen = next((item for item in providers if item.get("id") == selected), None)
    if chosen is None and providers:
        chosen = providers[0]
    if not chosen:
        return None
    key = chosen.get("api_key") or ""
    url = chosen.get("base_url") or ""
    model = chosen.get("model") or ""
    if not all(isinstance(value, str) for value in (key, url, model)):
        raise ValueError("服务地址、模型名与密钥必须为字符串")
    if not key or not url or not model:
        return None
    return {"base_url": url.rstrip("/"), "model": model, "api_key": key}


def chat_text(system: str, user: str, timeout: float = 45, max_tokens: int = 2500) -> str:
    provider = load_provider()
    if provider is None:
        raise RuntimeError("没有已配置的模型")
    base_url = provider["base_url"]
    url = base_url + ("/messages" if base_url.endswith("/v1") else "/v1/messages")
    payload = {
        "model": provider["model"],
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "x-api-key": provider["api_key"],
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:180]
        if provider["api_key"] and provider["api_key"] in detail:
            detail = detail.replace(provider["api_key"], "[redacted]")
        raise RuntimeError(f"模型请求失败（{error.code}）{detail}") from error
    parts = []
    for block in body.get("content") or []:
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text") or "")
        elif isinstance(block, str):
            parts.append(block)
    text = "".join(parts).strip()
    if not text:
        if body.get("stop_reason") == "max_tokens":
            raise RuntimeError("模型把输出用在内部思考上，没有交回决定")
        raise RuntimeError("模型没有返回文本")
    return text


def parse_json_object(text: str) -> dict:
    raw = text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
        raw = raw.rsplit("```", 1)[0]
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("模型没有返回 JSON 对象")
    data = json.loads(raw[start : end + 1])
    if not isinstance(data, dict):
        raise ValueError("模型返回的不是对象")
    return data
