import asyncio
import inspect
import json

import httpx
import pytest

from gallery.llm import DEFAULT_TIMEOUT_S, LlmError, make_openrouter_llm

KEY = "sk-or-secret"


def run(handler, system="s", user="u"):
    llm = make_openrouter_llm(KEY, "test/model", transport=httpx.MockTransport(handler))
    return asyncio.run(llm(system, user))


def ok(content="hello"):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


def test_sends_model_messages_and_auth():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return ok()

    run(handler, "SYS", "USER")
    assert seen["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert seen["auth"] == f"Bearer {KEY}"
    assert seen["body"]["model"] == "test/model"
    assert seen["body"]["temperature"] == 0.2
    assert seen["body"]["max_tokens"] == 1500
    assert seen["body"]["messages"] == [
        {"role": "system", "content": "SYS"},
        {"role": "user", "content": "USER"},
    ]


def test_returns_message_content():
    assert run(lambda r: ok('{"op":"add"}')) == '{"op":"add"}'


def test_non_200_raises_without_key():
    with pytest.raises(LlmError) as exc:
        run(lambda r: httpx.Response(401, text=f"bad key {KEY}"))
    assert KEY not in str(exc.value)


def test_bad_body_raises():
    with pytest.raises(LlmError):
        run(lambda r: httpx.Response(200, json={"choices": []}))


def test_default_deadline_is_under_the_browsers_8_s_wait():
    # The browser gives up at 8 s and the server's clock starts later; 7 s keeps paid answers deliverable.
    assert DEFAULT_TIMEOUT_S == 7.0
    assert inspect.signature(make_openrouter_llm).parameters["timeout"].default == DEFAULT_TIMEOUT_S


def test_timeout_raises_timeout_error():
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(TimeoutError):
        run(handler)


def test_total_timeout_bounds_a_slow_drip_response():
    import time

    class Drip(httpx.AsyncByteStream):
        async def __aiter__(self):
            for _ in range(100):
                await asyncio.sleep(0.05)
                yield b" "

    def handler(request):
        return httpx.Response(200, stream=Drip())

    llm = make_openrouter_llm(KEY, "test/model", timeout=0.2, transport=httpx.MockTransport(handler))
    start = time.monotonic()
    with pytest.raises(TimeoutError):
        asyncio.run(llm("s", "u"))
    assert time.monotonic() - start < 1.0
