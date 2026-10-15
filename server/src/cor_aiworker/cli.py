"""命令行入口：cor-aiworker serve / chat / key / mcp。"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import io
import json
import logging
import os
import sys
import time
from typing import Any, get_args

import uvicorn

from .api.app import create_app
from .api.security import generate_token
from .app.providers import MissingApiKeyError
from .app.runs import SessionBusyError
from .app.runtime import Runtime
from .config import Settings
from .instance import InstanceLockedError
from .kernel.providers.factory import PRESETS
from .kernel.types import Risk
from .keystore import Keystore, mcp_secret_name
from .storage.db import Database
from .storage.settings import McpServerRecord, SettingsStore

DEFAULT_PORT = 8765
DIM, CYAN, YELLOW, RED, RESET = "\033[2m", "\033[36m", "\033[33m", "\033[31m", "\033[0m"


# ── serve ─────────────────────────────────────────────────────────────────


class _Server(uvicorn.Server):
    """在完成端口绑定后发出信号，以便读取实际端口（--port 0 时由系统分配）。"""

    def __init__(self, config: uvicorn.Config) -> None:
        super().__init__(config)
        self.ready = asyncio.Event()

    async def startup(self, sockets: Any = None) -> None:
        await super().startup(sockets)
        self.ready.set()


def _write_server_info(settings: Settings, info: dict[str, Any]) -> None:
    # 文件里有访问令牌，只允许当前用户读取
    fd = os.open(settings.server_info_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(info, f, ensure_ascii=False, indent=2)


async def _serve(args: argparse.Namespace) -> None:
    settings = Settings.load()
    async with Runtime.open(settings) as runtime:
        _print_startup(runtime)
        token = generate_token()
        app = create_app(runtime, token=token, allowed_origins=args.allow_origin)
        # 安全模型第一层：只监听本机回环地址，不提供修改监听地址的选项
        server = _Server(uvicorn.Config(app, host="127.0.0.1", port=args.port, lifespan="off"))
        serving = asyncio.create_task(server.serve())
        ready = asyncio.create_task(server.ready.wait())
        await asyncio.wait({serving, ready}, return_when=asyncio.FIRST_COMPLETED)
        if serving.done():  # 启动失败（例如端口被占用）
            ready.cancel()
            await serving
            return

        port = server.servers[0].sockets[0].getsockname()[1]
        url = f"http://127.0.0.1:{port}"
        _write_server_info(
            settings,
            {
                "pid": os.getpid(),
                "port": port,
                "url": url,
                "token": token,
                "started_at": time.time(),
            },
        )
        print(f"本地服务已启动：{url}")
        print(f"接口文档：{url}/api/docs")
        print(f"访问令牌已写入 {settings.server_info_path}（仅当前用户可读）")
        try:
            await serving
        finally:
            settings.server_info_path.unlink(missing_ok=True)


def _print_startup(runtime: Runtime) -> None:
    print(f"数据目录：{runtime.settings.data_dir}")
    if runtime.recovered_runs:
        print(f"{YELLOW}上次退出时有 {runtime.recovered_runs} 个运行未完成，已标记为取消{RESET}")
    for name, error in runtime.mcp_errors.items():
        print(f"{RED}MCP 服务 {name} 连接失败：{error}{RESET}")
    tools = ", ".join(spec.name for spec in runtime.tools.specs())
    print(f"可用工具：{tools}")


# ── chat ──────────────────────────────────────────────────────────────────


class _Renderer:
    def __init__(self) -> None:
        self._mode = ""

    def _switch(self, mode: str) -> None:
        if mode != self._mode:
            print(RESET + ("\n" if self._mode else ""), end="")
            if mode == "thinking":
                print(DIM + "[思考] ", end="")
            self._mode = mode

    def event(self, kind: str, p: dict[str, Any]) -> None:
        if kind == "thinking_delta":
            self._switch("thinking")
            print(p["text"], end="", flush=True)
        elif kind == "text_delta":
            self._switch("text")
            print(p["text"], end="", flush=True)
        elif kind == "tool_call":
            self._switch("")
            raw = p["call"]["raw_arguments"]
            print(f"\n{CYAN}→ {p['call']['name']}({raw[:200]}){RESET}")
        elif kind == "tool_result":
            status = "失败" if p["is_error"] else "完成"
            preview = p["content"].replace("\n", " ")[:120]
            print(f"{CYAN}← {p['tool_name']} {status}：{preview}{RESET}")
        elif kind == "run_failed":
            self._switch("")
            print(f"\n{RED}运行失败：{p['error']}{RESET}")
        elif kind == "run_finished":
            self._switch("")
            u = p["usage"]
            print(
                f"\n{DIM}[{p['turns']} 轮 · {p['tool_calls']} 次工具调用 · 输入 {u['input_tokens']}"
                f"（缓存命中 {u['cache_read_tokens']}）· 输出 {u['output_tokens']} · "
                f"{p['elapsed']:.1f}s]{RESET}"
            )


async def _chat(args: argparse.Namespace) -> None:
    settings = Settings.load()
    async with Runtime.open(settings) as runtime:
        _print_startup(runtime)
        if args.session:
            session = await runtime.sessions.get(args.session)
            if session is None:
                sys.exit(f"会话不存在：{args.session}")
        else:
            session = await runtime.sessions.create(args.provider, model=args.model)
        print(f"{DIM}会话 {session.id} · {session.provider} / {session.model} · Ctrl-D 退出{RESET}")

        while True:
            try:
                user_input = await asyncio.to_thread(input, "\n你> ")
            except EOFError:
                break
            if not user_input.strip():
                continue
            try:
                run_id = await runtime.runs.start(session.id, user_input)
            except MissingApiKeyError as exc:
                print(f"{RED}{exc}，请先运行：cor-aiworker key set {exc.provider}{RESET}")
                continue
            except SessionBusyError as exc:
                print(f"{RED}{exc}{RESET}")
                continue
            await _follow_run(runtime, run_id, auto_approve=args.auto_approve)
        print(f"\n{DIM}继续这个会话：cor-aiworker chat --session {session.id}{RESET}")


async def _follow_run(runtime: Runtime, run_id: str, *, auto_approve: bool) -> None:
    renderer = _Renderer()
    async for event in runtime.runs.subscribe(run_id):
        renderer.event(event.type, event.payload)
        if event.type == "approval_requested":
            p = event.payload
            approved = auto_approve
            if not auto_approve:
                answer = await asyncio.to_thread(
                    input,
                    f"\n{YELLOW}⚠ {p['tool_name']}（{p['reason']}）是否允许？[y/N] {RESET}",
                )
                approved = answer.strip().lower() == "y"
            runtime.runs.resolve_approval(run_id, p["approval_id"], approved)


# ── key ───────────────────────────────────────────────────────────────────


def _key(args: argparse.Namespace) -> None:
    keystore = Keystore()
    if args.action == "list":
        for name, preset in PRESETS.items():
            mark = "✓ 已配置" if keystore.has(name) else "✗ 未配置"
            print(f"{name:<12} {mark}   默认模型 {preset.default_model}")
        return
    if args.provider not in PRESETS:
        sys.exit(f"未知的模型提供方：{args.provider}（可选：{', '.join(PRESETS)}）")
    if args.action == "set":
        secret = getpass.getpass(f"输入 {args.provider} 的 API Key（不会回显）：")
        try:
            keystore.set(args.provider, secret)
        except ValueError as exc:
            sys.exit(str(exc))
        print("已保存到系统钥匙串。")
    else:
        keystore.delete(args.provider)
        print("已删除。")


# ── mcp ───────────────────────────────────────────────────────────────────


async def _mcp(args: argparse.Namespace) -> None:
    settings = Settings.load()
    settings.ensure_dirs()
    db = await Database.open(settings.db_path)
    try:
        store = SettingsStore(db)
        if args.action == "list":
            records = await store.mcp_servers()
            if not records:
                print("尚未配置 MCP 服务。示例：cor-aiworker mcp add fetch -- uvx mcp-server-fetch")
            for r in records:
                state = "启用" if r.enabled else "停用"
                print(f"{r.name:<16} {state}  风险 {r.risk:<8} {r.command} {' '.join(r.args)}")
            return
        if args.action == "add":
            await _mcp_add(args, store)
        else:
            existing = {r.name: r for r in await store.mcp_servers()}
            if args.name not in existing or not await store.delete_mcp_server(args.name):
                sys.exit(f"MCP 服务不存在：{args.name}")
            keystore = Keystore()
            for secret_name in existing[args.name].env_refs.values():
                keystore.delete(secret_name)
            print(f"已删除 {args.name}。")
        print(f"{DIM}重启本地服务后生效。{RESET}")
    finally:
        await db.close()


async def _mcp_add(args: argparse.Namespace, store: SettingsStore) -> None:
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        sys.exit("缺少启动命令。示例：cor-aiworker mcp add fetch -- uvx mcp-server-fetch")
    env_refs: dict[str, str] = {}
    keystore = Keystore()
    for variable in args.secret_env:
        secret = getpass.getpass(f"输入环境变量 {variable} 的值（存入钥匙串，不会回显）：")
        name = mcp_secret_name(args.name, variable)
        keystore.set(name, secret)
        env_refs[variable] = name
    await store.save_mcp_server(
        McpServerRecord(
            name=args.name,
            command=command[0],
            args=command[1:],
            env_refs=env_refs,
            risk=args.risk,
            untrusted=not args.trusted,
        )
    )
    print(f"已保存 MCP 服务 {args.name}：{' '.join(command)}")


# ── 入口 ──────────────────────────────────────────────────────────────────


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cor-aiworker", description="本地优先的个人 Agent Harness"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    serve = sub.add_parser("serve", help="启动本地服务（HTTP API，仅监听 127.0.0.1）")
    serve.add_argument(
        "--port", type=int, default=DEFAULT_PORT, help=f"默认 {DEFAULT_PORT}；0 表示随机"
    )
    serve.add_argument(
        "--allow-origin",
        action="append",
        default=[],
        metavar="URL",
        help="允许跨域访问的前端地址（开发前端时使用），可重复",
    )

    chat = sub.add_parser("chat", help="在终端中对话")
    chat.add_argument("--provider", choices=list(PRESETS), default="deepseek")
    chat.add_argument("--model", help="覆盖默认模型")
    chat.add_argument("--session", help="继续一个已有会话")
    chat.add_argument("--auto-approve", action="store_true", help="自动同意所有审批（谨慎使用）")

    key = sub.add_parser("key", help="管理模型 API Key（存于系统钥匙串）")
    key_sub = key.add_subparsers(dest="action", required=True)
    key_sub.add_parser("list", help="查看配置情况")
    for action, text in (("set", "设置"), ("delete", "删除")):
        key_sub.add_parser(action, help=f"{text} API Key").add_argument("provider")

    mcp = sub.add_parser("mcp", help="管理 MCP 服务")
    mcp_sub = mcp.add_subparsers(dest="action", required=True)
    mcp_sub.add_parser("list", help="查看已配置的服务")
    add = mcp_sub.add_parser("add", help="添加或更新服务：mcp add 名称 [选项] -- 命令 参数…")
    add.add_argument("name")
    add.add_argument("--risk", choices=get_args(Risk), default="network")
    add.add_argument(
        "--trusted", action="store_true", help="输出视为可信（仅限纯本地、内容可控的服务）"
    )
    add.add_argument(
        "--secret-env",
        action="append",
        default=[],
        metavar="VAR",
        help="需要密钥的环境变量，值会提示输入并存入钥匙串，可重复",
    )
    add.add_argument("command", nargs=argparse.REMAINDER)
    mcp_sub.add_parser("remove", help="删除服务").add_argument("name")
    return parser


def main() -> None:
    args = _parser().parse_args()
    # 输出到管道时（例如由桌面应用以子进程启动）默认是块缓冲，提示信息会迟迟不出现
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(line_buffering=True)
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    # MCP 客户端会把子进程输出里的非协议内容（如 npm 安装日志）记为警告，对用户无意义
    logging.getLogger("mcp").setLevel(logging.ERROR)
    try:
        if args.command == "serve":
            logging.getLogger("cor_aiworker").setLevel(logging.INFO)
            asyncio.run(_serve(args))
        elif args.command == "chat":
            asyncio.run(_chat(args))
        elif args.command == "key":
            _key(args)
        else:
            asyncio.run(_mcp(args))
    except InstanceLockedError as exc:
        sys.exit(f"{exc}。请先停止正在运行的 cor-aiworker（serve 或 chat）。")
    except KeyboardInterrupt:
        pass
