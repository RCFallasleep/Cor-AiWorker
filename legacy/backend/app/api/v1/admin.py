"""后端管理界面：系统状态、数据库统计、在线用户、实时日志。"""
from __future__ import annotations

import logging
import os
import platform
import sys
import time
from datetime import datetime

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from app.services.corwork_db import get_db_stats
from app.services.user_service import list_users
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["Admin"])

_START_TIME = time.time()


@router.get("/stats", summary="系统统计信息（JSON）")
async def get_stats():
    uptime_s = int(time.time() - _START_TIME)
    h, rem = divmod(uptime_s, 3600)
    m, s = divmod(rem, 60)

    db_stats = await get_db_stats()
    users = await list_users(limit=5)

    return {
        "app": settings.app_name,
        "version": "0.1.0",
        "uptime": f"{h:02d}:{m:02d}:{s:02d}",
        "uptime_seconds": uptime_s,
        "python_version": sys.version.split()[0],
        "platform": platform.system(),
        "debug": settings.debug,
        "started_at": datetime.utcfromtimestamp(_START_TIME).isoformat() + "Z",
        "database": db_stats,
        "recent_users": users,
    }


@router.get("/", response_class=HTMLResponse, summary="管理界面首页", include_in_schema=False)
async def admin_dashboard():
    """返回管理界面 HTML 页面。"""
    return HTMLResponse(content=_DASHBOARD_HTML)


# ── 管理界面 HTML ─────────────────────────────────────────────────────────────

_DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cor-AiWorker 管理面板</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0a0a0a; color: #e5e5e5; min-height: 100vh;
  }
  .header {
    background: #111; border-bottom: 1px solid #222;
    padding: 16px 24px; display: flex; align-items: center; gap: 12px;
  }
  .header h1 { font-size: 16px; font-weight: 600; color: #fff; }
  .header .badge {
    font-size: 11px; padding: 2px 8px; border-radius: 20px;
    background: #1a3a1a; color: #4ade80; border: 1px solid #2d5a2d;
  }
  .nav { display: flex; gap: 4px; padding: 0 24px; background: #111; border-bottom: 1px solid #1a1a1a; }
  .nav a {
    padding: 10px 16px; font-size: 13px; color: #888; text-decoration: none;
    border-bottom: 2px solid transparent; cursor: pointer;
  }
  .nav a.active { color: #fff; border-bottom-color: #3b82f6; }
  .content { padding: 24px; max-width: 1200px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card {
    background: #111; border: 1px solid #1e1e1e; border-radius: 12px; padding: 20px;
  }
  .card .label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
  .card .value { font-size: 28px; font-weight: 700; color: #fff; }
  .card .sub { font-size: 12px; color: #555; margin-top: 4px; }
  .section { background: #111; border: 1px solid #1e1e1e; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
  .section h2 { font-size: 13px; font-weight: 600; color: #888; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.05em; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 12px; color: #555; font-weight: 500; border-bottom: 1px solid #1e1e1e; }
  td { padding: 10px 12px; border-bottom: 1px solid #141414; color: #ccc; }
  tr:last-child td { border-bottom: none; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: #4ade80; display: inline-block; margin-right: 6px; }
  .log-box {
    background: #0a0a0a; border: 1px solid #1e1e1e; border-radius: 8px;
    padding: 12px; font-family: 'SF Mono', monospace; font-size: 12px;
    color: #6ee7b7; height: 300px; overflow-y: auto; line-height: 1.6;
  }
  .refresh-btn {
    background: #1e1e1e; border: 1px solid #2a2a2a; color: #888;
    padding: 6px 14px; border-radius: 8px; font-size: 12px; cursor: pointer;
    float: right; margin-top: -4px;
  }
  .refresh-btn:hover { background: #2a2a2a; color: #fff; }
  .link { color: #3b82f6; text-decoration: none; font-size: 12px; }
  .link:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="header">
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2">
    <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
  </svg>
  <h1>Cor-AiWorker 管理面板</h1>
  <span class="badge"><span class="dot"></span>运行中</span>
</div>

<div class="nav">
  <a class="active" onclick="showTab('overview')">概览</a>
  <a onclick="showTab('users')">用户</a>
  <a onclick="showTab('logs')">日志</a>
  <a href="/docs" target="_blank">API 文档</a>
</div>

<div class="content">
  <!-- 概览 Tab -->
  <div id="tab-overview">
    <div class="grid" id="stat-cards">
      <div class="card"><div class="label">加载中</div><div class="value">...</div></div>
    </div>
    <div class="section">
      <h2>数据库统计 <button class="refresh-btn" onclick="loadStats()">刷新</button></h2>
      <table id="db-table">
        <tr><th>表名</th><th>记录数</th></tr>
      </table>
    </div>
    <div class="section">
      <h2>快速链接</h2>
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        <a class="link" href="/docs" target="_blank">📖 Swagger API 文档</a>
        <a class="link" href="/redoc" target="_blank">📋 ReDoc 文档</a>
        <a class="link" href="/health" target="_blank">❤️ 健康检查</a>
        <a class="link" href="/v1/admin/stats" target="_blank">📊 统计 JSON</a>
      </div>
    </div>
  </div>

  <!-- 用户 Tab -->
  <div id="tab-users" style="display:none">
    <div class="section">
      <h2>最近注册用户 <button class="refresh-btn" onclick="loadStats()">刷新</button></h2>
      <table>
        <tr><th>用户名</th><th>显示名</th><th>邮箱</th><th>注册时间</th><th>最后在线</th></tr>
        <tbody id="users-table"></tbody>
      </table>
    </div>
  </div>

  <!-- 日志 Tab -->
  <div id="tab-logs" style="display:none">
    <div class="section">
      <h2>系统日志（实时）<button class="refresh-btn" onclick="startLogStream()">重连</button></h2>
      <div class="log-box" id="log-box">等待日志流...</div>
    </div>
  </div>
</div>

<script>
let currentTab = 'overview';

function showTab(name) {
  document.querySelectorAll('[id^="tab-"]').forEach(el => el.style.display = 'none');
  document.getElementById('tab-' + name).style.display = 'block';
  document.querySelectorAll('.nav a').forEach((a, i) => {
    a.classList.toggle('active', ['overview','users','logs'][i] === name);
  });
  currentTab = name;
  if (name === 'logs') startLogStream();
}

async function loadStats() {
  try {
    const res = await fetch('/v1/admin/stats');
    const data = await res.json();

    // 统计卡片
    const cards = [
      { label: '运行时长', value: data.uptime, sub: '自启动以来' },
      { label: '注册用户', value: data.database?.tables?.users ?? '-', sub: '总计' },
      { label: '消息总数', value: data.database?.tables?.messages ?? '-', sub: '条' },
      { label: '项目数', value: data.database?.tables?.projects ?? '-', sub: '个' },
      { label: '数据库大小', value: (data.database?.db_size_kb ?? 0) + ' KB', sub: 'corwork.db' },
      { label: 'Python', value: data.python_version, sub: data.platform },
    ];
    document.getElementById('stat-cards').innerHTML = cards.map(c => `
      <div class="card">
        <div class="label">${c.label}</div>
        <div class="value">${c.value}</div>
        <div class="sub">${c.sub}</div>
      </div>
    `).join('');

    // 数据库表统计
    const tables = data.database?.tables || {};
    document.getElementById('db-table').innerHTML = '<tr><th>表名</th><th>记录数</th></tr>' +
      Object.entries(tables).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');

    // 用户列表
    const users = data.recent_users || [];
    document.getElementById('users-table').innerHTML = users.map(u => `
      <tr>
        <td>${u.username}</td>
        <td>${u.display_name || '-'}</td>
        <td>${u.email || '-'}</td>
        <td>${u.created_at ? u.created_at.slice(0,19).replace('T',' ') : '-'}</td>
        <td>${u.last_seen_at ? u.last_seen_at.slice(0,19).replace('T',' ') : '从未'}</td>
      </tr>
    `).join('') || '<tr><td colspan="5" style="color:#555;text-align:center">暂无用户</td></tr>';

  } catch(e) {
    console.error('loadStats failed', e);
  }
}

function startLogStream() {
  const box = document.getElementById('log-box');
  box.innerHTML = '连接日志流...<br>';
  // 轮询 /v1/logs 接口（现有接口）
  setInterval(async () => {
    if (currentTab !== 'logs') return;
    try {
      const res = await fetch('/v1/logs?limit=30');
      const data = await res.json();
      const runs = data.runs || [];
      if (runs.length === 0) { box.innerHTML = '暂无 Agent 执行日志'; return; }
      box.innerHTML = runs.slice(0, 20).map(r =>
        `<div>[${r.started_at?.slice(0,19).replace('T',' ')}] ${r.status === 'done' ? '✓' : r.status === 'error' ? '✗' : '⟳'} ${r.model} | ${r.user_query?.slice(0,60)} | ${r.total_duration_ms}ms</div>`
      ).join('');
    } catch(e) {}
  }, 3000);
}

// 初始加载
loadStats();
setInterval(loadStats, 30000);
</script>
</body>
</html>
"""
