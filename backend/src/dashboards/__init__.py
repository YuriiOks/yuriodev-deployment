"""Dashboards data API: tasks and calendar events for the three spaces, over REST and MCP.

Off unless DATABASE_URL is set (see `Settings.dashboards_enabled`). Layout: `models.py` tables,
`migrations/` Alembic, `runtime.py` engine + readiness, `service.py` queries and rules,
`schemas.py` request/response models, `gate.py` the auth + disabled gate in front of
/api/dashboards/** and /api/mcp, `mcp_server.py` the MCP tools. The REST router is
`src/routes/dashboards.py`.
"""
