from __future__ import annotations

import argparse
import os
from datetime import date, datetime, time
from pathlib import Path
from typing import List

from zoneinfo import ZoneInfo

from .activity import ActivityLogger
from .collector import InboxMemoryCollector
from .config_loader import CollectorConfig, SpaceConfig, load_config
from .custom_collectors import CollectorLoadError, CommandCollector, load_python_collector
from .digest import DigestGenerator
from .github_backup import GitHubBackup, GitHubEnv
from .memory import RollingMemoryBuilder
from .objective_state import ObjectiveStateBuilder
from .project_state import ProjectStateBuilder
from .seeds import SeedBuilder
from .state_manager import StateManager
from .utils import ensure_dir, load_env_file, to_iso, utc_now


def _log(message: str) -> None:
    print(f"[pipeline] {message}")


def _load_space_config(base_dir: Path) -> SpaceConfig:
    config_path = base_dir / "config" / "space.json"
    if not config_path.exists():
        raise FileNotFoundError(f"Missing config file: {config_path}")
    return load_config(config_path)


def _parse_time(value: str) -> time:
    hour, minute = value.split(":")
    return time(hour=int(hour), minute=int(minute))


def _should_run(local_now: datetime, target: str) -> bool:
    return local_now.time() >= _parse_time(target)


def _collector_objects(
    config: SpaceConfig,
    base_path: Path,
    state: StateManager,
    activity: ActivityLogger,
) -> List[object]:
    collectors: List[object] = []
    for collector_conf in config.collectors:
        if not collector_conf.enabled:
            continue

        if collector_conf.type == "python":
            try:
                collectors.append(
                    load_python_collector(
                        base_path=base_path,
                        config=config,
                        collector_conf=collector_conf,
                        state=state,
                        activity=activity,
                    )
                )
            except (CollectorLoadError, ImportError, AttributeError) as exc:
                print(f"[warn] {exc}. Custom python collector disabled.")
            continue

        if collector_conf.type == "command":
            collectors.append(
                CommandCollector(
                    base_path=base_path,
                    config=config,
                    collector_conf=collector_conf,
                    state=state,
                    activity=activity,
                )
            )
            continue

        if collector_conf.type != "builtin":
            print(
                f"[warn] unknown collector type '{collector_conf.type}' "
                f"for key '{collector_conf.key}'; skipping"
            )
            continue

        if collector_conf.key == "inbox_memory":
            collectors.append(
                InboxMemoryCollector(
                    base_path=base_path,
                    config=config,
                    collector_conf=collector_conf,
                    state=state,
                    activity=activity,
                )
            )
            continue

        print(f"[warn] unknown collector key '{collector_conf.key}' in config; skipping")
    return collectors


def build_pipeline(base_path: Path) -> dict:
    ensure_dir(base_path / "config")
    ensure_dir(base_path / "state")
    ensure_dir(base_path / "activity")
    ensure_dir(base_path / "buckets")

    config = _load_space_config(base_path)
    state = StateManager(base_path / "state" / "collector_state.json")
    activity = ActivityLogger(base_path / "activity" / "activity.jsonl")
    digest = DigestGenerator(base_path=base_path, config=config, activity=activity)
    memory_builder = RollingMemoryBuilder(base_path=base_path, activity=activity, config=config)
    project_state = ProjectStateBuilder(base_path=base_path, activity=activity, config=config)
    objective_state = ObjectiveStateBuilder(base_path=base_path, activity=activity, config=config)
    seeds = SeedBuilder(base_path=base_path, activity=activity)

    pipeline = {
        "config": config,
        "state": state,
        "activity": activity,
        "collectors": _collector_objects(config, base_path, state, activity),
        "digest": digest,
        "memory": memory_builder,
        "project_state": project_state,
        "objective_state": objective_state,
        "seeds": seeds,
        "base_path": base_path,
    }

    try:
        gh_env = GitHubEnv.from_env(default_root=f"{base_path.parent.name}/{config.space_slug}/")
        workspace_root = base_path.parent.parent
        extra_paths = []
        code_dir = workspace_root / "community_memory"
        if code_dir.exists():
            extra_paths.append((code_dir, Path("code") / "community_memory"))
        readme_path = workspace_root / "README.md"
        if readme_path.exists():
            extra_paths.append((readme_path, Path("code") / "README.md"))
        pipeline["github"] = GitHubBackup(
            base_path=base_path,
            env=gh_env,
            activity=activity,
            extra_paths=extra_paths,
        )
    except RuntimeError:
        pipeline["github"] = None

    return pipeline


def run_collectors(
    pipeline: dict, backfill_hours: int | None = None, force: bool = False
) -> None:
    collectors = pipeline["collectors"]
    if not collectors:
        _log("no collectors enabled; skipping")
        return
    suffix = f" (backfill={backfill_hours}h)" if backfill_hours else ""
    _log(f"running {len(collectors)} collector(s){suffix}")
    for collector in collectors:
        _log(f"starting collector {collector.collector_key}")
        result = collector.run(force=force, backfill_hours=backfill_hours)
        windows = result.get("windows_processed") if isinstance(result, dict) else None
        _log(
            f"collector {collector.collector_key}: {result.get('status')}"
            + (f", windows={windows}" if windows is not None else "")
        )


def run_digests(pipeline: dict, target_date: date, force: bool = False) -> None:
    _log(f"running digests for {target_date} (force={force})")
    outputs = pipeline["digest"].run_for_date(target_date, force=force)
    _log(f"digests generated for buckets: {', '.join(outputs.keys()) or 'none'}")


def run_memory(pipeline: dict, target_date: date, force: bool = False) -> None:
    run_state(pipeline, target_date, force=force)
    _log(f"running rolling memory for {target_date} (force={force})")
    output = pipeline["memory"].run(target_date, force=force)
    if output:
        _log(f"memory updated: {output}")
    else:
        _log("memory step skipped (already up to date or no digests)")


def run_state(pipeline: dict, target_date: date, force: bool = False) -> None:
    _log(f"running state builders for {target_date} (force={force})")
    state_output = pipeline["project_state"].run(target_date, force=force)
    if state_output:
        _log(f"project state updated: {state_output}")
    objective_output = pipeline["objective_state"].run(target_date, force=force)
    if objective_output:
        _log(f"objective state updated: {objective_output}")


def run_state_range(
    pipeline: dict,
    start_date: date,
    end_date: date,
    force: bool = False,
) -> None:
    _log(f"running state builders for {start_date}..{end_date} (force={force})")
    # Project state remains single-day for now; objective state is range-aware.
    state_output = pipeline["project_state"].run(end_date, force=force)
    if state_output:
        _log(f"project state updated: {state_output}")
    objective_output = pipeline["objective_state"].run_range(
        start_date,
        end_date,
        force=force,
        mode="bounded_backfill" if start_date != end_date else "forward",
    )
    if objective_output:
        _log(f"objective state updated: {objective_output}")


def run_seeds(pipeline: dict, target_date: date, force: bool = False) -> None:
    _log(f"running product seeds for {target_date} (force={force})")
    daily_output = pipeline["seeds"].run_daily(target_date, force=force)
    weekly_output = pipeline["seeds"].run_weekly(target_date, force=force)
    if daily_output:
        _log(f"daily product seed updated: {daily_output}")
    else:
        _log("daily product seed skipped (already up to date or missing inputs)")
    if weekly_output:
        _log(f"weekly product seed updated: {weekly_output}")
    else:
        _log("weekly product seed skipped (already up to date or missing inputs)")


def run_github_backup(pipeline: dict) -> None:
    github_backup = pipeline.get("github")
    if github_backup is None:
        raise RuntimeError("GitHub configuration is missing.")
    _log("running GitHub backup")
    uploaded = github_backup.run()
    _log(f"GitHub backup uploaded {len(uploaded)} file(s)")


def run_all(pipeline: dict, force: bool = False) -> None:
    config: SpaceConfig = pipeline["config"]
    tz = ZoneInfo(config.timezone)
    now = utc_now().astimezone(tz)
    today = now.date()

    _log(f"run start (force={force}) — local time {now.isoformat()}")
    run_collectors(pipeline, force=force)

    if force or _should_run(now, config.run.digest_run_time_local):
        run_digests(pipeline, today, force=force)
    else:
        _log("digest window not reached; skipping")

    if force or _should_run(now, config.run.memory_run_time_local):
        run_memory(pipeline, today, force=force)
        run_seeds(pipeline, today, force=force)
    else:
        _log("memory window not reached; skipping")

    if force or _should_run(now, config.run.github_backup_run_time_local):
        github_backup = pipeline.get("github")
        if github_backup:
            run_github_backup(pipeline)
        else:
            _log("GitHub backup disabled")
    else:
        _log("GitHub backup window not reached; skipping")

    _log("run finished")


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Community memory pipeline controller")
    parser.add_argument(
        "command",
        choices=["collect", "digest", "memory", "state", "seeds", "backup", "run"],
    )
    parser.add_argument(
        "--base",
        default=(Path(os.environ.get("PRISM_API_BUNDLED_BASE", "prism_seed").strip() or "prism_seed")).as_posix(),
        help="Base data directory",
    )
    parser.add_argument("--space", default=None, help="Space slug (defaults to config)")
    parser.add_argument("--date", help="Target date YYYY-MM-DD", default=None)
    parser.add_argument("--from-date", help="Start date YYYY-MM-DD for state backfill", default=None)
    parser.add_argument("--to-date", help="End date YYYY-MM-DD for state backfill", default=None)
    parser.add_argument("--backfill-hours", type=int, default=None, help="Override collector backfill window (hours)")
    parser.add_argument("--force", action="store_true")
    return parser


def main() -> None:
    load_env_file(Path(".env"))

    parser = build_arg_parser()
    args = parser.parse_args()

    base_dir = Path(args.base)
    space_slug = args.space or (os.environ.get("PRISM_API_SPACE", "community").strip() or "community")
    base_path = base_dir / space_slug

    pipeline = build_pipeline(base_path)

    target_date = date.fromisoformat(args.date) if args.date else utc_now().date()

    try:
        if args.command == "collect":
            run_collectors(
                pipeline, backfill_hours=args.backfill_hours, force=args.force
            )
        elif args.command == "digest":
            run_digests(pipeline, target_date, force=args.force)
        elif args.command == "memory":
            run_memory(pipeline, target_date, force=args.force)
        elif args.command == "state":
            if args.from_date or args.to_date:
                start_date = date.fromisoformat(args.from_date) if args.from_date else target_date
                end_date = date.fromisoformat(args.to_date) if args.to_date else target_date
                run_state_range(pipeline, start_date, end_date, force=args.force)
            else:
                run_state(pipeline, target_date, force=args.force)
        elif args.command == "seeds":
            run_seeds(pipeline, target_date, force=args.force)
        elif args.command == "backup":
            run_github_backup(pipeline)
        elif args.command == "run":
            run_all(pipeline, force=args.force)
    except Exception as exc:
        pipeline["activity"].log(
            "error",
            run_key=target_date.isoformat(),
            meta={
                "command": args.command,
                "error": str(exc),
                "ts_utc": to_iso(utc_now()),
            },
        )
        raise


if __name__ == "__main__":
    main()
