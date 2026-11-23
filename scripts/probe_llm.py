"""探测 DeepSeek API 连通性：只输出状态码与耗时，不打印 Key。

用途：区分"网络抖动"与"限流"，两者处理方式不同。
"""

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

env = {}
for line in Path(".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")

key = env.get("LLM_API_KEY", "")
base = env.get("LLM_API_BASE") or "https://api.deepseek.com"
print(f"endpoint = {base}/chat/completions")
print(f"api_key  = 已配置（长度 {len(key)}）" if key else "api_key  = 未配置")

if not key:
    raise SystemExit(2)

payload = {
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "ping"}],
    "max_tokens": 1,
    "stream": False,
}

for i in range(1, 4):
    started = time.time()
    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            body = json.loads(resp.read())
        elapsed = (time.time() - started) * 1000
        print(f"#{i}  HTTP {resp.status}  {elapsed:.0f} ms  model={body.get('model')}")
    except urllib.error.HTTPError as exc:
        elapsed = (time.time() - started) * 1000
        detail = exc.read().decode("utf-8", "ignore")[:200]
        print(f"#{i}  HTTP {exc.code}  {elapsed:.0f} ms  {detail}")
    except Exception as exc:  # noqa: BLE001
        elapsed = (time.time() - started) * 1000
        print(f"#{i}  失败  {elapsed:.0f} ms  {type(exc).__name__}: {exc}")
    time.sleep(1.5)
