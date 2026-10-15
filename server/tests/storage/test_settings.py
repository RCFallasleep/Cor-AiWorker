from __future__ import annotations

from cor_aiworker.storage.db import Database
from cor_aiworker.storage.settings import McpServerRecord, SettingsStore


async def test_mcp_server_upsert_list_delete(db: Database) -> None:
    store = SettingsStore(db)
    fetch = McpServerRecord("fetch", "uvx", ["mcp-server-fetch"])
    search = McpServerRecord(
        "search", "npx", ["-y", "search-mcp"], {"API_KEY": "mcp:search:API_KEY"}, enabled=False
    )
    await store.save_mcp_server(fetch)
    await store.save_mcp_server(search)
    assert await store.mcp_servers() == [fetch, search]
    assert await store.mcp_servers(enabled_only=True) == [fetch]

    updated = McpServerRecord("fetch", "uvx", ["mcp-server-fetch", "--ignore-robots-txt"])
    await store.save_mcp_server(updated)
    assert (await store.mcp_servers())[0] == updated

    assert await store.delete_mcp_server("search")
    assert not await store.delete_mcp_server("search")


async def test_tool_policies(db: Database) -> None:
    store = SettingsStore(db)
    await store.set_tool_policy("fetch__fetch", "allow")
    await store.set_tool_policy("write_file", "deny")
    await store.set_tool_policy("fetch__fetch", "ask")
    assert await store.tool_policies() == {"fetch__fetch": "ask", "write_file": "deny"}

    await store.clear_tool_policy("write_file")
    assert await store.tool_policies() == {"fetch__fetch": "ask"}
