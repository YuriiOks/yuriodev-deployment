"""Collectors: background pollers that turn outside work items into dashboards tasks.

`base.py` the contract and shared helpers, `github.py` and `linear.py` the two sources,
`sync.py` the database side (upsert, close, tombstones), `manager.py` the loop that runs them.
"""
