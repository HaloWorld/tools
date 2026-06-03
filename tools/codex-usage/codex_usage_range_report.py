#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore


# OpenAI Codex credit rate card, per 1M tokens.
# Source checked 2026-05-30:
# https://help.openai.com/en/articles/20001106-codex-rate-card
CODEX_CREDIT_PRICING = {
    "gpt-5.5": (125.0, 12.50, 750.0),
    "gpt-5.4": (62.50, 6.250, 375.0),
    "gpt-5.4-mini": (18.75, 1.875, 113.0),
    "gpt-5.3-codex": (43.75, 4.375, 350.0),
    "gpt-5.2": (43.75, 4.375, 350.0),
    # Research-preview / internal models: no public final rate at time of writing.
    "gpt-5.3-codex-spark": None,
    # Codex rate card says code review uses GPT-5.3-Codex.
    "codex-auto-review": (43.75, 4.375, 350.0),
}

# OpenAI API pricing, per 1M tokens.
# Source checked 2026-05-30:
# https://developers.openai.com/api/docs/pricing
API_PRICING = {
    "api-standard-short": {
        "gpt-5.5": (5.00, 0.50, 30.00),
        "gpt-5.5-pro": (30.00, None, 180.00),
        "gpt-5.4": (2.50, 0.25, 15.00),
        "gpt-5.4-mini": (0.75, 0.075, 4.50),
        "gpt-5.4-nano": (0.20, 0.02, 1.25),
        "gpt-5.4-pro": (30.00, None, 180.00),
        "gpt-5.3-codex": (1.75, 0.175, 14.00),
        "codex-auto-review": (1.75, 0.175, 14.00),
    },
    "api-standard-long": {
        "gpt-5.5": (10.00, 1.00, 45.00),
        "gpt-5.5-pro": (60.00, None, 270.00),
        "gpt-5.4": (5.00, 0.50, 22.50),
        "gpt-5.4-pro": (60.00, None, 270.00),
    },
    "api-batch-short": {
        "gpt-5.5": (2.50, 0.25, 15.00),
        "gpt-5.5-pro": (15.00, None, 90.00),
        "gpt-5.4": (1.25, 0.125, 7.50),
        "gpt-5.4-mini": (0.375, 0.0375, 2.25),
        "gpt-5.4-nano": (0.10, 0.01, 0.625),
        "gpt-5.4-pro": (15.00, None, 90.00),
    },
    "api-batch-long": {
        "gpt-5.5": (5.00, 0.50, 22.50),
        "gpt-5.4": (2.50, 0.25, 11.25),
        "gpt-5.4-pro": (30.00, None, 135.00),
    },
    "api-flex-short": {
        "gpt-5.5": (2.50, 0.25, 15.00),
        "gpt-5.5-pro": (15.00, None, 90.00),
        "gpt-5.4": (1.25, 0.125, 7.50),
        "gpt-5.4-mini": (0.375, 0.0375, 2.25),
        "gpt-5.4-nano": (0.10, 0.01, 0.625),
        "gpt-5.4-pro": (15.00, None, 90.00),
    },
    "api-flex-long": {
        "gpt-5.5": (5.00, 0.50, 22.50),
        "gpt-5.4": (2.50, 0.25, 11.25),
        "gpt-5.4-pro": (30.00, None, 135.00),
    },
    "api-priority-short": {
        "gpt-5.5": (12.50, 1.25, 75.00),
        "gpt-5.4": (5.00, 0.50, 30.00),
        "gpt-5.4-mini": (1.50, 0.15, 9.00),
        "gpt-5.3-codex": (3.50, 0.35, 28.00),
        "codex-auto-review": (3.50, 0.35, 28.00),
    },
}

MODEL_ALIASES = {
    "gpt5.5": "gpt-5.5",
    "gpt5.4": "gpt-5.4",
    "gpt5.4mini": "gpt-5.4-mini",
    "gpt5.3codex": "gpt-5.3-codex",
    "gpt5.2": "gpt-5.2",
    "gpt-5.4-codex": "gpt-5.4",
    "gpt-5-codex": "gpt-5.4",
    "gpt-5.4-mini-fast": "gpt-5.4-mini",
    "gpt-5.4-fast": "gpt-5.4",
    "gpt-5.5-fast": "gpt-5.5",
    "gpt-5.3-codex-fast": "gpt-5.3-codex",
}


@dataclass
class Usage:
    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0
    reasoning_output_tokens: int = 0

    def add(self, other: "Usage") -> None:
        self.input_tokens += other.input_tokens
        self.cached_input_tokens += other.cached_input_tokens
        self.output_tokens += other.output_tokens
        self.reasoning_output_tokens += other.reasoning_output_tokens

    def scaled(self, factor: float) -> "Usage":
        return Usage(
            input_tokens=round(self.input_tokens * factor),
            cached_input_tokens=round(self.cached_input_tokens * factor),
            output_tokens=round(self.output_tokens * factor),
            reasoning_output_tokens=round(self.reasoning_output_tokens * factor),
        )

    @property
    def raw_total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    @property
    def uncached_input_tokens(self) -> int:
        return max(0, self.input_tokens - self.cached_input_tokens)

    @property
    def cli_display_total(self) -> int:
        return self.uncached_input_tokens + self.output_tokens

    def tuple4(self) -> Tuple[int, int, int, int]:
        return (self.input_tokens, self.cached_input_tokens, self.output_tokens, self.reasoning_output_tokens)

    def to_dict(self) -> Dict[str, int]:
        return {
            "input_tokens": self.input_tokens,
            "cached_input_tokens": self.cached_input_tokens,
            "uncached_input_tokens": self.uncached_input_tokens,
            "output_tokens": self.output_tokens,
            "reasoning_output_tokens": self.reasoning_output_tokens,
            "raw_total_tokens": self.raw_total_tokens,
            "cli_display_total": self.cli_display_total,
        }


@dataclass
class Snapshot:
    ts: datetime
    cumulative: Usage
    model: str
    raw_model: str
    session_id: str
    session_label: str
    session_path: str
    turn_id: str
    task_label: str
    source: Optional[str]
    cwd: Optional[str]


@dataclass
class TokenEvent:
    ts: datetime
    usage: Usage
    model: str
    raw_model: str
    session_id: str
    session_label: str
    session_path: str
    turn_id: str
    task_label: str
    source: Optional[str]
    cwd: Optional[str]


@dataclass
class AggregateRecord:
    key: str
    usage: Usage = field(default_factory=Usage)
    credits: float = 0.0
    usd: float = 0.0
    meta: Dict[str, Any] = field(default_factory=dict)
    models: Counter = field(default_factory=Counter)

    def sort_metric(self) -> int:
        return self.usage.raw_total_tokens

    def to_dict(self) -> Dict[str, Any]:
        d = {
            "key": self.key,
            **self.usage.to_dict(),
            "credits": self.credits,
            "usd": self.usd,
            "models": dict(self.models),
        }
        d.update(self.meta)
        return d


class Aggregator:
    def __init__(self) -> None:
        self.overall = Usage()
        self.events_counted = 0
        self.session_rows: Dict[str, AggregateRecord] = {}
        self.task_rows: Dict[Tuple[str, str], AggregateRecord] = {}
        self.day_rows: Dict[str, AggregateRecord] = {}
        self.week_rows: Dict[str, AggregateRecord] = {}
        self.model_rows: Dict[str, AggregateRecord] = {}

    def add_event(self, event: TokenEvent, credits: float, usd: float, day_key: str, week_key: str) -> None:
        self.events_counted += 1
        self.overall.add(event.usage)

        sr = self.session_rows.setdefault(
            event.session_id,
            AggregateRecord(
                key=event.session_id,
                meta={
                    "label": event.session_label,
                    "path": event.session_path,
                    "source": event.source,
                    "cwd": event.cwd,
                    "first_seen": event.ts.isoformat(),
                },
            ),
        )
        sr.usage.add(event.usage)
        sr.credits += credits
        sr.usd += usd
        sr.models[event.model] += event.usage.raw_total_tokens
        sr.meta["last_seen"] = event.ts.isoformat()

        task_key = (event.session_id, event.turn_id)
        tr = self.task_rows.setdefault(
            task_key,
            AggregateRecord(
                key=f"{event.session_id}:{event.turn_id}",
                meta={
                    "session_id": event.session_id,
                    "turn_id": event.turn_id,
                    "label": event.task_label,
                    "session_label": event.session_label,
                    "path": event.session_path,
                    "source": event.source,
                    "cwd": event.cwd,
                    "first_seen": event.ts.isoformat(),
                },
            ),
        )
        tr.usage.add(event.usage)
        tr.credits += credits
        tr.usd += usd
        tr.models[event.model] += event.usage.raw_total_tokens
        tr.meta["last_seen"] = event.ts.isoformat()

        dr = self.day_rows.setdefault(day_key, AggregateRecord(key=day_key, meta={"day": day_key}))
        dr.usage.add(event.usage)
        dr.credits += credits
        dr.usd += usd
        dr.models[event.model] += event.usage.raw_total_tokens

        wr = self.week_rows.setdefault(week_key, AggregateRecord(key=week_key, meta={"week": week_key}))
        wr.usage.add(event.usage)
        wr.credits += credits
        wr.usd += usd
        wr.models[event.model] += event.usage.raw_total_tokens

        mr = self.model_rows.setdefault(event.model, AggregateRecord(key=event.model, meta={"model": event.model}))
        mr.usage.add(event.usage)
        mr.credits += credits
        mr.usd += usd
        mr.models[event.model] += event.usage.raw_total_tokens


@dataclass
class ScanStats:
    files_scanned: int = 0
    files_with_token_events: int = 0
    files_failed: int = 0
    snapshots_seen: int = 0
    exact_duplicate_snapshots_dropped: int = 0
    replay_or_nonmonotonic_snapshots_dropped: int = 0
    zero_delta_snapshots_dropped: int = 0
    sessions_seen: int = 0


@dataclass
class SessionState:
    file_path: str
    session_id: Optional[str] = None
    session_start: Optional[datetime] = None
    session_label: str = "(untitled session)"
    source: Optional[str] = None
    cwd: Optional[str] = None
    current_model: str = "unknown"
    current_raw_model: str = "unknown"
    current_turn_id: Optional[str] = None
    current_task_label: str = "(unknown task)"
    first_user_message: Optional[str] = None
    last_user_message: Optional[str] = None
    token_events_seen: int = 0


class PriceBook:
    def __init__(
        self,
        mode: str,
        usd_per_1000_credits: Optional[float],
        region_uplift: float,
        fast_credit_multiplier: Optional[float],
    ):
        self.mode = mode
        self.usd_per_credit = (usd_per_1000_credits / 1000.0) if usd_per_1000_credits is not None else None
        self.region_uplift = region_uplift
        self.fast_credit_multiplier = fast_credit_multiplier

    def _lookup_rates(self, model: str, raw_model: Optional[str] = None) -> Optional[Tuple[Optional[float], Optional[float], Optional[float]]]:
        if self.mode == "credits":
            rates = CODEX_CREDIT_PRICING.get(model)
            if rates is None:
                return None
            raw = (raw_model or "").lower()
            if self.fast_credit_multiplier and "fast" in raw:
                return tuple(x * self.fast_credit_multiplier for x in rates)  # type: ignore[misc]
            return rates
        table = API_PRICING.get(self.mode)
        if table is None:
            return None
        return table.get(model)

    def price_usage(self, model: str, usage: Usage, raw_model: Optional[str] = None) -> Tuple[float, float]:
        rates = self._lookup_rates(model, raw_model)
        if rates is None:
            return 0.0, 0.0
        input_rate, cached_rate, output_rate = rates
        if input_rate is None or output_rate is None:
            return 0.0, 0.0
        val = (usage.uncached_input_tokens / 1_000_000) * input_rate
        if cached_rate is not None:
            val += (usage.cached_input_tokens / 1_000_000) * cached_rate
        val += (usage.output_tokens / 1_000_000) * output_rate
        if self.mode.startswith("api"):
            return 0.0, val * self.region_uplift
        usd = val * self.usd_per_credit if self.usd_per_credit is not None else 0.0
        return val, usd


def eprint(*args: Any) -> None:
    print(*args, file=sys.stderr)


def get_local_tz(name: Optional[str]):
    if name:
        if ZoneInfo is None:
            raise SystemExit("Python zoneinfo is unavailable; remove --timezone or use Python 3.9+.")
        return ZoneInfo(name)
    return datetime.now().astimezone().tzinfo or timezone.utc


def parse_bound(s: Optional[str], tz, is_end: bool = False) -> Optional[datetime]:
    if not s:
        return None
    text = s.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        dt = datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=tz)
        return dt + timedelta(days=1) if is_end else dt
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=tz)
    else:
        dt = dt.astimezone(tz)
    return dt


def parse_timestamp(s: Optional[str], tz) -> Optional[datetime]:
    if not s:
        return None
    try:
        text = s[:-1] + "+00:00" if s.endswith("Z") else s
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(tz)
    except Exception:
        return None


def normalize_model(raw: Optional[str]) -> str:
    if not raw:
        return "unknown"
    m = raw.strip().lower().replace("_", "-")
    return MODEL_ALIASES.get(m, m)


def human_tokens(n: int) -> str:
    sign = "-" if n < 0 else ""
    n = abs(n)
    for unit, scale in (("T", 1_000_000_000_000), ("B", 1_000_000_000), ("M", 1_000_000), ("K", 1_000)):
        if n >= scale:
            v = n / scale
            if v >= 100:
                return f"{sign}{v:.0f}{unit}"
            if v >= 10:
                return f"{sign}{v:.1f}{unit}"
            return f"{sign}{v:.2f}{unit}"
    return f"{sign}{n}"


def human_money(v: float) -> str:
    return f"${v:,.2f}"


def human_credits(v: float) -> str:
    return f"{v:,.2f}"


def shorten(text: Optional[str], width: int = 100) -> str:
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= width else text[: width - 1] + "…"


def extract_user_text(obj: Dict[str, Any]) -> Optional[str]:
    typ = obj.get("type")
    if typ == "event_msg":
        payload = obj.get("payload", {})
        if payload.get("type") == "user_message":
            msg = payload.get("message")
            return msg if isinstance(msg, str) else None
    if typ == "response_item":
        payload = obj.get("payload", {})
        if payload.get("type") == "message" and payload.get("role") == "user":
            for item in payload.get("content") or []:
                if isinstance(item, dict):
                    text = item.get("text")
                    if isinstance(text, str) and not text.lstrip().startswith("<environment_context>"):
                        return text
    return None


def usage_from_dict(total: Dict[str, Any]) -> Usage:
    return Usage(
        input_tokens=int(total.get("input_tokens", 0) or 0),
        cached_input_tokens=int(total.get("cached_input_tokens", 0) or 0),
        output_tokens=int(total.get("output_tokens", 0) or 0),
        reasoning_output_tokens=int(total.get("reasoning_output_tokens", 0) or 0),
    )


def make_delta(curr: Usage, prev: Optional[Usage]) -> Usage:
    prev = prev or Usage()
    return Usage(
        input_tokens=max(0, curr.input_tokens - prev.input_tokens),
        cached_input_tokens=max(0, curr.cached_input_tokens - prev.cached_input_tokens),
        output_tokens=max(0, curr.output_tokens - prev.output_tokens),
        reasoning_output_tokens=max(0, curr.reasoning_output_tokens - prev.reasoning_output_tokens),
    )


def is_zero(u: Usage) -> bool:
    return u.input_tokens == 0 and u.cached_input_tokens == 0 and u.output_tokens == 0 and u.reasoning_output_tokens == 0


def week_key(dt: datetime) -> str:
    iso = dt.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def safe_json(line: str) -> Optional[Dict[str, Any]]:
    try:
        obj = json.loads(line)
        return obj if isinstance(obj, dict) else None
    except Exception:
        return None


def choose_session_label(state: SessionState) -> str:
    if state.first_user_message:
        return shorten(state.first_user_message, 120)
    if state.cwd:
        return Path(state.cwd).name or state.cwd
    return "(untitled session)"


def collect_snapshots_from_file(path: Path, snapshots: List[Snapshot], tz, stats: ScanStats) -> None:
    stats.files_scanned += 1
    state = SessionState(file_path=str(path))
    saw_event = False
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                obj = safe_json(line)
                if obj is None:
                    continue
                ts = parse_timestamp(obj.get("timestamp"), tz)
                if obj.get("type") == "session_meta":
                    payload = obj.get("payload", {})
                    state.session_id = payload.get("id") or state.session_id
                    state.source = payload.get("source") or state.source
                    state.cwd = payload.get("cwd") or state.cwd
                    state.session_start = parse_timestamp(payload.get("timestamp"), tz) or ts or state.session_start
                    continue
                if obj.get("type") == "turn_context":
                    payload = obj.get("payload", {})
                    state.current_turn_id = payload.get("turn_id") or state.current_turn_id
                    raw_model = payload.get("model") or state.current_raw_model
                    state.current_raw_model = raw_model
                    state.current_model = normalize_model(raw_model)
                    state.cwd = payload.get("cwd") or state.cwd
                    continue
                maybe_user = extract_user_text(obj)
                if maybe_user:
                    text = shorten(maybe_user, 160)
                    if text:
                        state.last_user_message = text
                        if state.first_user_message is None:
                            state.first_user_message = text
                            state.session_label = text
                        state.current_task_label = text
                if obj.get("type") != "event_msg":
                    continue
                payload = obj.get("payload", {})
                if payload.get("type") != "token_count":
                    continue
                info = payload.get("info") or {}
                total = info.get("total_token_usage")
                if not isinstance(total, dict) or ts is None:
                    continue
                state.token_events_seen += 1
                saw_event = True
                stats.snapshots_seen += 1
                if not state.session_label or state.session_label == "(untitled session)":
                    state.session_label = choose_session_label(state)
                snapshots.append(
                    Snapshot(
                        ts=ts,
                        cumulative=usage_from_dict(total),
                        model=state.current_model,
                        raw_model=state.current_raw_model,
                        session_id=state.session_id or f"missing:{path.name}",
                        session_label=state.session_label,
                        session_path=str(path),
                        turn_id=state.current_turn_id or f"synthetic-{state.token_events_seen:06d}",
                        task_label=state.current_task_label or state.session_label,
                        source=state.source,
                        cwd=state.cwd,
                    )
                )
    except Exception as exc:
        stats.files_failed += 1
        eprint(f"WARN failed to scan {path}: {exc}")
        return
    if saw_event:
        stats.files_with_token_events += 1


def emit_event(event: TokenEvent, agg: Aggregator, pb: PriceBook, start: Optional[datetime], end: Optional[datetime], tz) -> None:
    if start and event.ts < start:
        return
    if end and event.ts >= end:
        return
    credits, usd = pb.price_usage(event.model, event.usage, event.raw_model)
    local = event.ts.astimezone(tz)
    agg.add_event(event, credits, usd, local.date().isoformat(), week_key(local))


def build_events_delta_global(snapshots: List[Snapshot], stats: ScanStats) -> List[TokenEvent]:
    by_session: Dict[str, List[Snapshot]] = defaultdict(list)
    for s in snapshots:
        by_session[s.session_id].append(s)
    stats.sessions_seen = len(by_session)

    events: List[TokenEvent] = []
    for session_id, rows in by_session.items():
        rows.sort(key=lambda s: (s.ts, s.cumulative.raw_total_tokens, s.cumulative.tuple4(), s.session_path))
        seen_cumulative: set[Tuple[int, int, int, int]] = set()
        prev: Optional[Usage] = None
        prev_raw = -1
        for s in rows:
            sig = s.cumulative.tuple4()
            if sig in seen_cumulative:
                stats.exact_duplicate_snapshots_dropped += 1
                continue
            seen_cumulative.add(sig)
            curr_raw = s.cumulative.raw_total_tokens
            if prev is not None and curr_raw <= prev_raw:
                stats.replay_or_nonmonotonic_snapshots_dropped += 1
                continue
            delta = make_delta(s.cumulative, prev)
            if is_zero(delta):
                stats.zero_delta_snapshots_dropped += 1
                prev = s.cumulative
                prev_raw = curr_raw
                continue
            events.append(
                TokenEvent(
                    ts=s.ts,
                    usage=delta,
                    model=s.model,
                    raw_model=s.raw_model,
                    session_id=s.session_id,
                    session_label=s.session_label,
                    session_path=s.session_path,
                    turn_id=s.turn_id,
                    task_label=s.task_label,
                    source=s.source,
                    cwd=s.cwd,
                )
            )
            prev = s.cumulative
            prev_raw = curr_raw
    return sorted(events, key=lambda e: (e.ts, e.session_id, e.turn_id))


def build_events_session_final(snapshots: List[Snapshot], stats: ScanStats, start: Optional[datetime], end: Optional[datetime]) -> List[TokenEvent]:
    by_session: Dict[str, List[Snapshot]] = defaultdict(list)
    for s in snapshots:
        by_session[s.session_id].append(s)
    stats.sessions_seen = len(by_session)

    events: List[TokenEvent] = []
    for session_id, rows in by_session.items():
        rows.sort(key=lambda s: (s.ts, s.cumulative.raw_total_tokens, s.cumulative.tuple4(), s.session_path))
        in_range = [s for s in rows if (start is None or s.ts >= start) and (end is None or s.ts < end)]
        if not in_range:
            continue
        # Pick one final/max cumulative snapshot for the session in the requested range.
        s = max(in_range, key=lambda x: (x.cumulative.raw_total_tokens, x.ts))
        events.append(
            TokenEvent(
                ts=s.ts,
                usage=s.cumulative,
                model=s.model,
                raw_model=s.raw_model,
                session_id=s.session_id,
                session_label=s.session_label,
                session_path=s.session_path,
                turn_id=s.turn_id,
                task_label=s.task_label,
                source=s.source,
                cwd=s.cwd,
            )
        )
    return sorted(events, key=lambda e: (e.ts, e.session_id, e.turn_id))


def sort_rows(rows: Iterable[AggregateRecord], limit: int) -> List[AggregateRecord]:
    return sorted(rows, key=lambda r: r.sort_metric(), reverse=True)[:limit]


def dominant_model(models: Counter) -> str:
    return models.most_common(1)[0][0] if models else "unknown"


def print_table(title: str, rows: List[AggregateRecord], kind: str, pricing_mode: str) -> None:
    print(title)
    if not rows:
        print("  (none)\n")
        return
    price_header = "credits" if pricing_mode == "credits" else "usd"
    if kind == "session":
        headers = ["#", "session", "model", "raw", "input", "cached", "uncached", "output", price_header, "label"]
        data = []
        for i, r in enumerate(rows, 1):
            price = human_credits(r.credits) if pricing_mode == "credits" else human_money(r.usd)
            data.append([
                str(i), shorten(r.key, 10), dominant_model(r.models), human_tokens(r.usage.raw_total_tokens),
                human_tokens(r.usage.input_tokens), human_tokens(r.usage.cached_input_tokens),
                human_tokens(r.usage.uncached_input_tokens), human_tokens(r.usage.output_tokens), price,
                shorten(r.meta.get("label"), 80),
            ])
    elif kind == "task":
        headers = ["#", "session", "turn", "model", "raw", "input", "cached", "uncached", "output", price_header, "label"]
        data = []
        for i, r in enumerate(rows, 1):
            price = human_credits(r.credits) if pricing_mode == "credits" else human_money(r.usd)
            data.append([
                str(i), shorten(r.meta.get("session_id"), 10), shorten(r.meta.get("turn_id"), 10),
                dominant_model(r.models), human_tokens(r.usage.raw_total_tokens), human_tokens(r.usage.input_tokens),
                human_tokens(r.usage.cached_input_tokens), human_tokens(r.usage.uncached_input_tokens),
                human_tokens(r.usage.output_tokens), price, shorten(r.meta.get("label"), 80),
            ])
    else:
        headers = ["#", kind, "raw", "input", "cached", "uncached", "output", price_header]
        data = []
        for i, r in enumerate(rows, 1):
            price = human_credits(r.credits) if pricing_mode == "credits" else human_money(r.usd)
            data.append([
                str(i), r.key, human_tokens(r.usage.raw_total_tokens), human_tokens(r.usage.input_tokens),
                human_tokens(r.usage.cached_input_tokens), human_tokens(r.usage.uncached_input_tokens),
                human_tokens(r.usage.output_tokens), price,
            ])
    widths = [max(len(row[i]) for row in ([headers] + data)) for i in range(len(headers))]
    print("  " + "  ".join(headers[i].ljust(widths[i]) for i in range(len(headers))))
    print("  " + "  ".join("-" * widths[i] for i in range(len(headers))))
    for row in data:
        print("  " + "  ".join(row[i].ljust(widths[i]) for i in range(len(headers))))
    print()


def aggregate_events(events: List[TokenEvent], pb: PriceBook, start: Optional[datetime], end: Optional[datetime], tz) -> Aggregator:
    agg = Aggregator()
    for e in events:
        emit_event(e, agg, pb, start, end, tz)
    return agg


def scale_aggregate(agg: Aggregator, factor: float, pb: PriceBook) -> Aggregator:
    # Reprice scaled rows independently so rounded totals are coherent enough for reporting.
    out = Aggregator()
    for rows_name in ("session_rows", "task_rows", "day_rows", "week_rows", "model_rows"):
        src_rows: Dict[Any, AggregateRecord] = getattr(agg, rows_name)
        dst_rows: Dict[Any, AggregateRecord] = getattr(out, rows_name)
        for key, rec in src_rows.items():
            model = dominant_model(rec.models)
            usage = rec.usage.scaled(factor)
            credits, usd = pb.price_usage(model, usage, model)
            dst_rows[key] = AggregateRecord(
                key=rec.key,
                usage=usage,
                credits=credits,
                usd=usd,
                meta=dict(rec.meta),
                models=Counter({model: usage.raw_total_tokens}),
            )
    out.overall = agg.overall.scaled(factor)
    out.events_counted = agg.events_counted
    return out


def collect_files(codex_home: Path) -> List[Path]:
    out: List[Path] = []
    for sub in ("sessions", "archived_sessions"):
        root = codex_home / sub
        if root.exists():
            out.extend(sorted(root.rglob("*.jsonl")))
    return out


def build_json(agg: Aggregator, stats: ScanStats, args: argparse.Namespace, start: Optional[datetime], end: Optional[datetime]) -> Dict[str, Any]:
    return {
        "range": {"from": start.isoformat() if start else None, "to": end.isoformat() if end else None, "timezone": args.timezone},
        "count_mode": args.count_mode,
        "pricing_mode": args.pricing_mode,
        "pricing": {
            "usd_per_1000_credits": args.usd_per_1000_credits,
            "api_region_uplift": args.api_region_uplift,
            "fast_credit_multiplier": args.fast_credit_multiplier,
            "profile_total": args.profile_total,
            "profile_basis": args.profile_basis,
        },
        "summary": {
            **agg.overall.to_dict(),
            "credits": sum(r.credits for r in agg.model_rows.values()),
            "usd": sum(r.usd for r in agg.model_rows.values()),
        },
        "scan_stats": {
            "files_scanned": stats.files_scanned,
            "files_with_token_events": stats.files_with_token_events,
            "files_failed": stats.files_failed,
            "snapshots_seen": stats.snapshots_seen,
            "sessions_seen": stats.sessions_seen,
            "token_events_counted": agg.events_counted,
            "exact_duplicate_snapshots_dropped": stats.exact_duplicate_snapshots_dropped,
            "replay_or_nonmonotonic_snapshots_dropped": stats.replay_or_nonmonotonic_snapshots_dropped,
            "zero_delta_snapshots_dropped": stats.zero_delta_snapshots_dropped,
        },
        "top_sessions": [r.to_dict() for r in sort_rows(agg.session_rows.values(), args.top)],
        "top_tasks": [r.to_dict() for r in sort_rows(agg.task_rows.values(), args.top)],
        "top_days": [r.to_dict() for r in sort_rows(agg.day_rows.values(), args.top)],
        "top_weeks": [r.to_dict() for r in sort_rows(agg.week_rows.values(), args.top)],
        "top_models": [r.to_dict() for r in sort_rows(agg.model_rows.values(), args.top)],
    }


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Analyze local Codex session JSONL files with cross-file session de-duplication, pricing equivalents, and top session/task/day/week reports."
    )
    p.add_argument("--codex-home", default=str(Path.home() / ".codex"), help="Codex home directory. Default: ~/.codex")
    p.add_argument("--from", dest="date_from", help="Start date/time, e.g. 2026-05-01 or 2026-05-01T08:00:00+08:00")
    p.add_argument("--to", dest="date_to", help="End date/time; plain dates are inclusive, e.g. 2026-05-31")
    p.add_argument("--timezone", help="IANA timezone for grouping days/weeks, e.g. Asia/Shanghai")
    p.add_argument("--top", type=int, default=10, help="Rows to show in each top list. Default: 10")
    p.add_argument(
        "--count-mode",
        choices=["delta-global", "session-final"],
        default="delta-global",
        help=(
            "delta-global: collect all cumulative token snapshots, de-duplicate by session across files, "
            "then count only monotonic deltas once. session-final: include one max/final cumulative snapshot per session in range."
        ),
    )
    p.add_argument(
        "--pricing-mode",
        choices=["credits"] + sorted(API_PRICING.keys()),
        default="credits",
        help="credits = Codex credits. api-* = API-equivalent USD using official API rate tables.",
    )
    p.add_argument("--usd-per-1000-credits", type=float, default=None, help="Optional credit->USD conversion, e.g. 40 means 1000 credits = $40.")
    p.add_argument("--api-region-uplift", type=float, default=1.0, help="Multiply API-equivalent USD by this factor. Use 1.10 for regional processing uplift.")
    p.add_argument("--fast-credit-multiplier", type=float, default=None, help="Optional multiplier for raw model names containing 'fast', e.g. 2.5 for GPT-5.5 fast mode.")
    p.add_argument("--profile-total", type=float, default=None, help="Optional profile UI total token count to scale results to, e.g. 3440000000.")
    p.add_argument("--profile-basis", choices=["raw", "cli"], default="raw", help="When --profile-total is set, scale raw_total_tokens or cli_display_total to match it. Default: raw.")
    p.add_argument("--json", action="store_true", help="Print JSON instead of human-readable tables.")
    return p.parse_args(argv)


def print_summary(title: str, agg: Aggregator, args: argparse.Namespace) -> None:
    print(title)
    u = agg.overall
    print(f"  input_tokens:            {u.input_tokens:,} ({human_tokens(u.input_tokens)})")
    print(f"  cached_input_tokens:     {u.cached_input_tokens:,} ({human_tokens(u.cached_input_tokens)})")
    print(f"  uncached_input_tokens:   {u.uncached_input_tokens:,} ({human_tokens(u.uncached_input_tokens)})")
    print(f"  output_tokens:           {u.output_tokens:,} ({human_tokens(u.output_tokens)})")
    print(f"  reasoning_output_tokens: {u.reasoning_output_tokens:,} ({human_tokens(u.reasoning_output_tokens)})")
    print(f"  raw_total_tokens:        {u.raw_total_tokens:,} ({human_tokens(u.raw_total_tokens)})")
    print(f"  cli_display_total:       {u.cli_display_total:,} ({human_tokens(u.cli_display_total)})")
    print()
    if args.pricing_mode == "credits":
        credits = sum(r.credits for r in agg.model_rows.values())
        usd = sum(r.usd for r in agg.model_rows.values())
        print("Equivalent pricing (Codex credits)")
        print(f"  credits: {human_credits(credits)}")
        if args.usd_per_1000_credits is not None:
            print(f"  usd:     {human_money(usd)}")
    else:
        usd = sum(r.usd for r in agg.model_rows.values())
        print(f"Equivalent pricing ({args.pricing_mode})")
        print(f"  usd: {human_money(usd)}")
    print()


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    tz = get_local_tz(args.timezone)
    args.timezone = args.timezone or str(tz)
    start = parse_bound(args.date_from, tz, is_end=False)
    end = parse_bound(args.date_to, tz, is_end=True)
    codex_home = Path(os.path.expanduser(args.codex_home))
    if not codex_home.exists():
        eprint(f"ERROR Codex home does not exist: {codex_home}")
        return 2
    files = collect_files(codex_home)
    if not files:
        eprint(f"ERROR No JSONL files found under {codex_home}/sessions or {codex_home}/archived_sessions")
        return 2

    pb = PriceBook(args.pricing_mode, args.usd_per_1000_credits, args.api_region_uplift, args.fast_credit_multiplier)
    stats = ScanStats()
    snapshots: List[Snapshot] = []
    for path in files:
        collect_snapshots_from_file(path, snapshots, tz, stats)

    if args.count_mode == "delta-global":
        events = build_events_delta_global(snapshots, stats)
        agg = aggregate_events(events, pb, start, end, tz)
    else:
        events = build_events_session_final(snapshots, stats, start, end)
        # In session-final mode, events are already pre-filtered by range; avoid filtering twice.
        agg = aggregate_events(events, pb, None, None, tz)

    if args.profile_total is not None:
        basis = agg.overall.raw_total_tokens if args.profile_basis == "raw" else agg.overall.cli_display_total
        if basis <= 0:
            eprint("ERROR --profile-total was set, but the selected profile basis is zero.")
            return 2
        factor = float(args.profile_total) / float(basis)
        agg = scale_aggregate(agg, factor, pb)
    else:
        factor = None

    if args.json:
        out = build_json(agg, stats, args, start, end)
        if factor is not None:
            out["profile_scaling_factor"] = factor
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0

    print("Range")
    print(f"  from: {start.isoformat() if start else '(beginning)'}")
    print(f"  to:   {end.isoformat() if end else '(end)'}")
    print(f"  count_mode: {args.count_mode}")
    if factor is not None:
        print(f"  profile_scaled: {args.profile_total:,.0f} on basis={args.profile_basis}, factor={factor:.6f}")
    print()
    print_summary("Usage summary", agg, args)
    print("Scan stats")
    print(f"  files_scanned:                         {stats.files_scanned}")
    print(f"  files_with_token_events:               {stats.files_with_token_events}")
    print(f"  files_failed:                          {stats.files_failed}")
    print(f"  snapshots_seen:                        {stats.snapshots_seen}")
    print(f"  sessions_seen:                         {stats.sessions_seen}")
    print(f"  token_events_counted:                  {agg.events_counted}")
    print(f"  exact_duplicate_snapshots_dropped:      {stats.exact_duplicate_snapshots_dropped}")
    print(f"  replay_or_nonmonotonic_snapshots_drop: {stats.replay_or_nonmonotonic_snapshots_dropped}")
    print(f"  zero_delta_snapshots_dropped:           {stats.zero_delta_snapshots_dropped}")
    print()
    print_table("Top sessions", sort_rows(agg.session_rows.values(), args.top), "session", args.pricing_mode)
    print_table("Top tasks", sort_rows(agg.task_rows.values(), args.top), "task", args.pricing_mode)
    print_table("Top days", sort_rows(agg.day_rows.values(), args.top), "day", args.pricing_mode)
    print_table("Top weeks", sort_rows(agg.week_rows.values(), args.top), "week", args.pricing_mode)
    print_table("Top models", sort_rows(agg.model_rows.values(), args.top), "model", args.pricing_mode)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
