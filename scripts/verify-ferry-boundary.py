"""Verify ferry against a disposable SQLite copy without exposing row content."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path

from memory_agent.recall.handoff import SQLiteHandoffStore


def database_snapshot(database: Path) -> dict[str, dict[str, object]]:
    snapshot: dict[str, dict[str, object]] = {}
    with closing(sqlite3.connect(database)) as connection:
        table_names = [
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        for table_name in table_names:
            quoted = '"' + table_name.replace('"', '""') + '"'
            rows = connection.execute(f"SELECT * FROM {quoted}").fetchall()
            digest = hashlib.sha256()
            for row in rows:
                digest.update(repr(tuple(row)).encode("utf-8"))
                digest.update(b"\n")
            snapshot[table_name] = {
                "rows": len(rows),
                "sha256": digest.hexdigest(),
            }
    return snapshot


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--target-carrier", default="wechat")
    args = parser.parse_args()

    source = args.db.resolve()
    before_source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix="cyberboss-ferry-boundary-") as directory:
        copied = Path(directory) / "memory.sqlite3"
        shutil.copy2(source, copied)
        before_copy_hash = hashlib.sha256(copied.read_bytes()).hexdigest()
        before_files = sorted(item.name for item in copied.parent.iterdir())
        before = database_snapshot(copied)
        result = SQLiteHandoffStore(copied).ferry(
            target_carrier=args.target_carrier,
        )
        after = database_snapshot(copied)
        after_copy_hash = hashlib.sha256(copied.read_bytes()).hexdigest()
        after_files = sorted(item.name for item in copied.parent.iterdir())
    after_source_hash = hashlib.sha256(source.read_bytes()).hexdigest()

    changed_tables = sorted(
        name
        for name in set(before) | set(after)
        if before.get(name) != after.get(name)
    )
    report = {
        "copy_only": True,
        "ferry_status": result.status,
        "logical_tables_changed": changed_tables,
        "copy_file_changed": before_copy_hash != after_copy_hash,
        "copy_auxiliary_files_created": sorted(set(after_files) - set(before_files)),
        "source_database_unchanged": before_source_hash == after_source_hash,
        "memory_rows_before": before.get("memories", {}).get("rows"),
        "memory_rows_after": after.get("memories", {}).get("rows"),
        "source_cache_rows_before": before.get("memory_source_cache", {}).get("rows"),
        "source_cache_rows_after": after.get("memory_source_cache", {}).get("rows"),
    }
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0 if not changed_tables and report["source_database_unchanged"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
