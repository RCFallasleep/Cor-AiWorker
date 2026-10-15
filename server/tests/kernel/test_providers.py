"""适配器的纯函数测试，不发起网络请求。"""

from __future__ import annotations

import pytest
from openai.types.chat.chat_completion_chunk import (
    ChoiceDeltaToolCall,
    ChoiceDeltaToolCallFunction,
)

from cor_aiworker.kernel.providers.anthropic import AnthropicProvider
from cor_aiworker.kernel.providers.factory import create_provider
from cor_aiworker.kernel.providers.openai_compat import (
    OpenAICompatProvider,
    ToolCallAccumulator,
    map_stop,
    prepare_history,
)
from cor_aiworker.kernel.types import NativeMessage, ToolResult


def anthropic() -> AnthropicProvider:
    return AnthropicProvider(api_key="test", model="m")


def openai_compat() -> OpenAICompatProvider:
    return OpenAICompatProvider(name="x", api_key="test", base_url="http://localhost", model="m")


# ── Anthropic ──────────────────────────────────────────────────────────────


def test_anthropic_tool_results_share_one_user_message() -> None:
    messages = anthropic().tool_result_messages(
        [ToolResult("a", "ok"), ToolResult("b", "bad", is_error=True)]
    )
    assert len(messages) == 1
    blocks = messages[0]["content"]
    assert [b["tool_use_id"] for b in blocks] == ["a", "b"]
    assert [b["is_error"] for b in blocks] == [False, True]


def test_anthropic_unanswered_tool_calls() -> None:
    provider = anthropic()
    assistant = {
        "role": "assistant",
        "content": [
            {"type": "thinking", "thinking": "", "signature": "s"},
            {"type": "tool_use", "id": "t1", "name": "x", "input": {}},
        ],
    }
    assert provider.unanswered_tool_calls([assistant]) == ["t1"]
    answered = [assistant, *provider.tool_result_messages([ToolResult("t1", "ok")])]
    assert provider.unanswered_tool_calls(answered) == []
    assert provider.unanswered_tool_calls([]) == []


# ── OpenAI 兼容 ─────────────────────────────────────────────────────────────


def fragment(index: int, *, id: str = "", name: str = "", args: str = "") -> ChoiceDeltaToolCall:
    return ChoiceDeltaToolCall(
        index=index,
        id=id or None,
        type="function",
        function=ChoiceDeltaToolCallFunction(name=name or None, arguments=args or None),
    )


def test_accumulator_merges_fragments_by_index() -> None:
    acc = ToolCallAccumulator()
    acc.add([fragment(0, id="c0", name="a", args='{"x"')])
    acc.add([fragment(1, id="c1", name="b", args="{}")])
    acc.add([fragment(0, args=": 1}")])
    assert acc.calls() == [
        {"id": "c0", "name": "a", "arguments": '{"x": 1}'},
        {"id": "c1", "name": "b", "arguments": "{}"},
    ]


def test_prepare_history_keeps_reasoning_only_for_current_question() -> None:
    history: list[NativeMessage] = [
        {"role": "user", "content": "旧问题"},
        {"role": "assistant", "content": "旧回答", "reasoning_content": "旧推理"},
        {"role": "user", "content": "新问题"},
        {"role": "assistant", "content": None, "reasoning_content": "新推理", "tool_calls": []},
        {"role": "tool", "tool_call_id": "c1", "content": "结果"},
    ]
    prepared = prepare_history(history)
    assert "reasoning_content" not in prepared[1]
    assert prepared[3]["reasoning_content"] == "新推理"
    assert history[1]["reasoning_content"] == "旧推理"  # 原历史不被修改


def test_openai_unanswered_tool_calls() -> None:
    provider = openai_compat()
    assistant: NativeMessage = {
        "role": "assistant",
        "content": None,
        "tool_calls": [{"id": "c1"}, {"id": "c2"}],
    }
    partial: list[NativeMessage] = [
        assistant,
        {"role": "tool", "tool_call_id": "c1", "content": "ok"},
    ]
    assert provider.unanswered_tool_calls(partial) == ["c2"]
    complete = [*partial, {"role": "tool", "tool_call_id": "c2", "content": "ok"}]
    assert provider.unanswered_tool_calls(complete) == []


def test_openai_tool_errors_are_marked_in_content() -> None:
    [message] = openai_compat().tool_result_messages([ToolResult("c1", "失败", is_error=True)])
    assert message["content"].startswith("[ERROR]")


@pytest.mark.parametrize(
    ("raw", "has_calls", "expected"),
    [
        ("stop", False, "end"),
        ("stop", True, "tool_calls"),
        ("tool_calls", True, "tool_calls"),
        ("length", True, "max_tokens"),
        ("content_filter", False, "refusal"),
        ("weird", False, "other"),
    ],
)
def test_map_stop(raw: str, has_calls: bool, expected: str) -> None:
    assert map_stop(raw, has_calls) == expected


# ── 工厂 ──────────────────────────────────────────────────────────────────


def test_factory_presets() -> None:
    assert create_provider("anthropic", api_key="k").model == "claude-opus-5-5"
    deepseek = create_provider("deepseek", api_key="k", model="deepseek-v4-flash")
    assert (deepseek.name, deepseek.model) == ("deepseek", "deepseek-v4-flash")
    with pytest.raises(ValueError, match="未知"):
        create_provider("nope", api_key="k")
