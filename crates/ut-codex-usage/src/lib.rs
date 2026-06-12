use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Datelike, Local, NaiveDate, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use clap::Parser;
use comfy_table::{presets::UTF8_FULL, Attribute, Cell, Color, ContentArrangement, Table};
use console::{measure_text_width, style, Term};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::cmp::Reverse;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

const CACHE_VERSION: &str = "3-rs";
const DEFAULT_USD_PER_1000_CREDITS: f64 = 40.0;

#[derive(Parser, Debug, Clone)]
#[command(
    name = "ut-codex-usage",
    about = "Analyze local Codex usage from session JSONL files.",
    version,
    disable_help_subcommand = true
)]
struct Args {
    #[arg(value_name = "RANGE")]
    range: Option<String>,

    #[arg(long)]
    doctor: bool,

    #[arg(long = "codex-home", value_name = "DIR", default_value_os_t = default_codex_home())]
    codex_home: PathBuf,

    #[arg(long = "from", value_name = "DATE")]
    date_from: Option<String>,

    #[arg(long = "to", value_name = "DATE")]
    date_to: Option<String>,

    #[arg(long, value_name = "ZONE")]
    timezone: Option<String>,

    #[arg(long, default_value_t = 10)]
    top: usize,

    #[arg(long, default_value = "delta-global", value_parser = ["delta-global", "session-final"])]
    count_mode: String,

    #[arg(long, default_value = "credits")]
    pricing_mode: String,

    #[arg(long, default_value_t = DEFAULT_USD_PER_1000_CREDITS)]
    usd_per_1000_credits: f64,

    #[arg(long, default_value_t = 1.0)]
    api_region_uplift: f64,

    #[arg(long)]
    fast_credit_multiplier: Option<f64>,

    #[arg(long, value_parser = parse_token_count_arg)]
    profile_total: Option<f64>,

    #[arg(long, default_value = "raw", value_parser = ["raw", "cli"])]
    profile_basis: String,

    #[arg(long = "json")]
    json_output: bool,
}

#[derive(Clone, Debug)]
pub struct ReportOptions {
    pub range: Option<String>,
    pub codex_home: PathBuf,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub timezone: Option<String>,
    pub top: usize,
    pub count_mode: String,
    pub pricing_mode: String,
    pub usd_per_1000_credits: f64,
    pub api_region_uplift: f64,
    pub fast_credit_multiplier: Option<f64>,
    pub profile_total: Option<f64>,
    pub profile_basis: String,
}

impl Default for ReportOptions {
    fn default() -> Self {
        Self {
            range: None,
            codex_home: default_codex_home(),
            date_from: None,
            date_to: None,
            timezone: None,
            top: 10,
            count_mode: "delta-global".to_string(),
            pricing_mode: "credits".to_string(),
            usd_per_1000_credits: DEFAULT_USD_PER_1000_CREDITS,
            api_region_uplift: 1.0,
            fast_credit_multiplier: None,
            profile_total: None,
            profile_basis: "raw".to_string(),
        }
    }
}

impl ReportOptions {
    pub fn all_history() -> Self {
        Self {
            range: Some("all".to_string()),
            ..Self::default()
        }
    }
}

struct GeneratedReport {
    args: Args,
    agg: Aggregator,
    stats: ScanStats,
    cache_stats: CacheStats,
    timezone_name: String,
    start: Option<DateTime<Utc>>,
    end: Option<DateTime<Utc>>,
    profile_comparison: Option<BTreeMap<String, f64>>,
    factor: Option<f64>,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, Eq, PartialEq, Hash)]
struct Usage {
    input_tokens: i64,
    cached_input_tokens: i64,
    output_tokens: i64,
    reasoning_output_tokens: i64,
}

impl Usage {
    fn add(&mut self, other: Usage) {
        self.input_tokens += other.input_tokens;
        self.cached_input_tokens += other.cached_input_tokens;
        self.output_tokens += other.output_tokens;
        self.reasoning_output_tokens += other.reasoning_output_tokens;
    }

    fn scaled(self, factor: f64) -> Self {
        Self {
            input_tokens: (self.input_tokens as f64 * factor).round() as i64,
            cached_input_tokens: (self.cached_input_tokens as f64 * factor).round() as i64,
            output_tokens: (self.output_tokens as f64 * factor).round() as i64,
            reasoning_output_tokens: (self.reasoning_output_tokens as f64 * factor).round() as i64,
        }
    }

    fn raw_total_tokens(self) -> i64 {
        self.input_tokens + self.output_tokens
    }

    fn uncached_input_tokens(self) -> i64 {
        (self.input_tokens - self.cached_input_tokens).max(0)
    }

    fn cli_display_total(self) -> i64 {
        self.uncached_input_tokens() + self.output_tokens
    }

    fn tuple4(self) -> (i64, i64, i64, i64) {
        (
            self.input_tokens,
            self.cached_input_tokens,
            self.output_tokens,
            self.reasoning_output_tokens,
        )
    }

    fn to_json(self) -> Value {
        json!({
            "input_tokens": self.input_tokens,
            "cached_input_tokens": self.cached_input_tokens,
            "uncached_input_tokens": self.uncached_input_tokens(),
            "output_tokens": self.output_tokens,
            "reasoning_output_tokens": self.reasoning_output_tokens,
            "raw_total_tokens": self.raw_total_tokens(),
            "cli_display_total": self.cli_display_total(),
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Snapshot {
    ts: DateTime<Utc>,
    cumulative: Usage,
    model: String,
    raw_model: String,
    session_id: String,
    session_label: String,
    session_path: String,
    turn_id: String,
    task_label: String,
    source: Option<String>,
    cwd: Option<String>,
}

#[derive(Clone, Debug)]
struct TokenEvent {
    ts: DateTime<Utc>,
    usage: Usage,
    model: String,
    raw_model: String,
    session_id: String,
    session_label: String,
    session_path: String,
    turn_id: String,
    task_label: String,
    source: Option<String>,
    cwd: Option<String>,
}

#[derive(Clone, Debug, Default)]
struct AggregateRecord {
    key: String,
    usage: Usage,
    credits: f64,
    usd: f64,
    meta: BTreeMap<String, String>,
    models: HashMap<String, i64>,
}

impl AggregateRecord {
    fn sort_metric(&self) -> i64 {
        self.usage.raw_total_tokens()
    }

    fn to_json(&self) -> Value {
        let mut obj = serde_json::Map::new();
        obj.insert("key".to_string(), json!(self.key));
        if let Value::Object(usage_obj) = self.usage.to_json() {
            obj.extend(usage_obj);
        }
        obj.insert("credits".to_string(), json!(self.credits));
        obj.insert("usd".to_string(), json!(self.usd));
        obj.insert("models".to_string(), json!(self.models));
        for (k, v) in &self.meta {
            obj.insert(k.clone(), json!(v));
        }
        Value::Object(obj)
    }
}

#[derive(Debug, Default)]
struct Aggregator {
    overall: Usage,
    events_counted: usize,
    session_rows: HashMap<String, AggregateRecord>,
    task_rows: HashMap<(String, String), AggregateRecord>,
    day_rows: HashMap<String, AggregateRecord>,
    week_rows: HashMap<String, AggregateRecord>,
    model_rows: HashMap<String, AggregateRecord>,
}

#[derive(Debug, Default)]
struct ScanStats {
    files_scanned: usize,
    files_with_token_events: usize,
    files_failed: usize,
    snapshots_seen: usize,
    exact_duplicate_snapshots_dropped: usize,
    replay_or_nonmonotonic_snapshots_dropped: usize,
    zero_delta_snapshots_dropped: usize,
    sessions_seen: usize,
}

#[derive(Debug)]
struct CacheStats {
    enabled: bool,
    used: bool,
    rebuilt: bool,
    files_seen: usize,
    hash_hits: usize,
    hash_misses: usize,
    file_hits: usize,
    file_misses: usize,
    files_written: usize,
    cache_dir: Option<PathBuf>,
    reason: Option<String>,
}

impl Default for CacheStats {
    fn default() -> Self {
        Self {
            enabled: true,
            used: false,
            rebuilt: false,
            files_seen: 0,
            hash_hits: 0,
            hash_misses: 0,
            file_hits: 0,
            file_misses: 0,
            files_written: 0,
            cache_dir: None,
            reason: None,
        }
    }
}

#[derive(Debug)]
struct SessionState {
    file_path: String,
    session_id: Option<String>,
    session_start: Option<DateTime<Utc>>,
    session_label: String,
    source: Option<String>,
    cwd: Option<String>,
    current_model: String,
    current_raw_model: String,
    current_turn_id: Option<String>,
    current_task_label: String,
    first_user_message: Option<String>,
    token_events_seen: usize,
}

impl SessionState {
    fn new(file_path: String) -> Self {
        Self {
            file_path,
            session_id: None,
            session_start: None,
            session_label: "(untitled session)".to_string(),
            source: None,
            cwd: None,
            current_model: "unknown".to_string(),
            current_raw_model: "unknown".to_string(),
            current_turn_id: None,
            current_task_label: "(unknown task)".to_string(),
            first_user_message: None,
            token_events_seen: 0,
        }
    }
}

#[derive(Clone, Debug)]
enum TimezoneChoice {
    Local,
    Iana(Tz),
}

#[derive(Clone, Debug)]
struct PriceBook {
    mode: String,
    usd_per_credit: f64,
    region_uplift: f64,
    fast_credit_multiplier: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct HashIndex {
    version: String,
    files: HashMap<String, HashEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct HashEntry {
    size: u64,
    mtime_ns: u64,
    content_sha256: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct FileSnapshotCache {
    version: String,
    path: String,
    content_sha256: String,
    snapshots: Vec<Snapshot>,
}

fn default_codex_home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".codex")
}

fn args_from_options(options: ReportOptions, json_output: bool) -> Args {
    Args {
        range: options.range,
        doctor: false,
        codex_home: options.codex_home,
        date_from: options.date_from,
        date_to: options.date_to,
        timezone: options.timezone,
        top: options.top,
        count_mode: options.count_mode,
        pricing_mode: options.pricing_mode,
        usd_per_1000_credits: options.usd_per_1000_credits,
        api_region_uplift: options.api_region_uplift,
        fast_credit_multiplier: options.fast_credit_multiplier,
        profile_total: options.profile_total,
        profile_basis: options.profile_basis,
        json_output,
    }
}

pub fn parse_profile_total(value: &str) -> Result<f64> {
    parse_token_count_arg(value).map_err(anyhow::Error::msg)
}

fn parse_token_count_arg(value: &str) -> std::result::Result<f64, String> {
    let text = value.trim().replace(['_', ','], "");
    let re = Regex::new(r"^([0-9]+(?:\.[0-9]+)?)([kKmMbBtT]?)$").map_err(|err| err.to_string())?;
    let caps = re
        .captures(&text)
        .ok_or_else(|| "expected a number such as 18400000000 or 18.4B".to_string())?;
    let number: f64 = caps[1]
        .parse()
        .map_err(|_| "invalid numeric token count".to_string())?;
    let scale = match caps.get(2).map(|m| m.as_str().to_ascii_uppercase()) {
        Some(unit) if unit == "K" => 1_000.0,
        Some(unit) if unit == "M" => 1_000_000.0,
        Some(unit) if unit == "B" => 1_000_000_000.0,
        Some(unit) if unit == "T" => 1_000_000_000_000.0,
        _ => 1.0,
    };
    Ok(number * scale)
}

fn parse_timezone(name: Option<&str>) -> Result<TimezoneChoice> {
    match name {
        Some(value) => Ok(TimezoneChoice::Iana(
            value
                .parse::<Tz>()
                .with_context(|| format!("invalid timezone: {value}"))?,
        )),
        None => Ok(TimezoneChoice::Local),
    }
}

fn timezone_label(args_tz: Option<&str>, tz: &TimezoneChoice) -> String {
    if let Some(value) = args_tz {
        return value.to_string();
    }
    match tz {
        TimezoneChoice::Local => Local::now().offset().to_string(),
        TimezoneChoice::Iana(value) => value.name().to_string(),
    }
}

fn localize_naive(naive: NaiveDateTime, tz: &TimezoneChoice) -> Result<DateTime<Utc>> {
    match tz {
        TimezoneChoice::Local => Local
            .from_local_datetime(&naive)
            .earliest()
            .map(|dt| dt.with_timezone(&Utc))
            .ok_or_else(|| anyhow!("invalid local datetime: {naive}")),
        TimezoneChoice::Iana(zone) => zone
            .from_local_datetime(&naive)
            .earliest()
            .map(|dt| dt.with_timezone(&Utc))
            .ok_or_else(|| anyhow!("invalid datetime in timezone {zone}: {naive}")),
    }
}

fn parse_bound(
    value: Option<&str>,
    tz: &TimezoneChoice,
    is_end: bool,
) -> Result<Option<DateTime<Utc>>> {
    let Some(text) = value.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    if let Ok(date) = NaiveDate::parse_from_str(text, "%Y-%m-%d") {
        let date = if is_end {
            date.succ_opt()
                .ok_or_else(|| anyhow!("date overflow: {text}"))?
        } else {
            date
        };
        let naive = date
            .and_hms_opt(0, 0, 0)
            .ok_or_else(|| anyhow!("invalid date: {text}"))?;
        return Ok(Some(localize_naive(naive, tz)?));
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(text) {
        return Ok(Some(dt.with_timezone(&Utc)));
    }
    let naive = NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S")
        .with_context(|| format!("invalid date/time: {text}"))?;
    Ok(Some(localize_naive(naive, tz)?))
}

fn default_month_start(tz: &TimezoneChoice) -> Result<DateTime<Utc>> {
    let now = Local::now();
    let date = NaiveDate::from_ymd_opt(now.year(), now.month(), 1)
        .ok_or_else(|| anyhow!("invalid current month"))?;
    let naive = date
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| anyhow!("invalid current month start"))?;
    localize_naive(naive, tz)
}

fn parse_timestamp(value: Option<&Value>) -> Option<DateTime<Utc>> {
    let text = value?.as_str()?;
    DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn normalize_model(raw: &str) -> String {
    let m = raw.trim().to_ascii_lowercase().replace('_', "-");
    match m.as_str() {
        "gpt5.5" => "gpt-5.5",
        "gpt5.4" => "gpt-5.4",
        "gpt5.4mini" => "gpt-5.4-mini",
        "gpt5.3codex" => "gpt-5.3-codex",
        "gpt5.2" => "gpt-5.2",
        "gpt-5.4-codex" | "gpt-5-codex" | "gpt-5.4-fast" => "gpt-5.4",
        "gpt-5.4-mini-fast" => "gpt-5.4-mini",
        "gpt-5.5-fast" => "gpt-5.5",
        "gpt-5.3-codex-fast" => "gpt-5.3-codex",
        _ => m.as_str(),
    }
    .to_string()
}

fn human_tokens(value: i64) -> String {
    let sign = if value < 0 { "-" } else { "" };
    let n = (value as f64).abs();
    for (unit, scale) in [
        ("T", 1_000_000_000_000.0),
        ("B", 1_000_000_000.0),
        ("M", 1_000_000.0),
        ("K", 1_000.0),
    ] {
        if n >= scale {
            let v = n / scale;
            if v >= 100.0 {
                return format!("{sign}{v:.0}{unit}");
            }
            if v >= 10.0 {
                return format!("{sign}{v:.1}{unit}");
            }
            return format!("{sign}{v:.2}{unit}");
        }
    }
    format!("{sign}{}", n as i64)
}

fn format_int(value: i64) -> String {
    let sign = if value < 0 { "-" } else { "" };
    let digits = value.unsigned_abs().to_string();
    let mut out = String::new();
    for (idx, ch) in digits.chars().rev().enumerate() {
        if idx > 0 && idx % 3 == 0 {
            out.push(',');
        }
        out.push(ch);
    }
    format!("{sign}{}", out.chars().rev().collect::<String>())
}

fn format_decimal(value: f64, decimals: usize) -> String {
    let raw = format!("{value:.decimals$}");
    let Some((whole, fraction)) = raw.split_once('.') else {
        return format_int(raw.parse::<i64>().unwrap_or_default());
    };
    let whole = whole.parse::<i64>().unwrap_or_default();
    format!("{}.{}", format_int(whole), fraction)
}

fn human_money(value: f64) -> String {
    format!("${}", format_decimal(value, 2))
}

fn human_credits(value: f64) -> String {
    format_decimal(value, 2)
}

fn shorten(text: Option<&str>, width: usize) -> String {
    let Some(text) = text else {
        return String::new();
    };
    let squashed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if squashed.chars().count() <= width {
        return squashed;
    }
    squashed
        .chars()
        .take(width.saturating_sub(3))
        .collect::<String>()
        + "..."
}

fn extract_user_text(obj: &Value) -> Option<String> {
    if obj.get("type")?.as_str()? == "event_msg" {
        let payload = obj.get("payload")?;
        if payload.get("type")?.as_str()? == "user_message" {
            return payload.get("message")?.as_str().map(ToString::to_string);
        }
    }
    if obj.get("type")?.as_str()? == "response_item" {
        let payload = obj.get("payload")?;
        if payload.get("type")?.as_str()? == "message" && payload.get("role")?.as_str()? == "user" {
            for item in payload.get("content")?.as_array()? {
                if let Some(text) = item.get("text").and_then(Value::as_str) {
                    if !text.trim_start().starts_with("<environment_context>") {
                        return Some(text.to_string());
                    }
                }
            }
        }
    }
    None
}

fn usage_from_value(total: &Value) -> Usage {
    Usage {
        input_tokens: total
            .get("input_tokens")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
        cached_input_tokens: total
            .get("cached_input_tokens")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
        output_tokens: total
            .get("output_tokens")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
        reasoning_output_tokens: total
            .get("reasoning_output_tokens")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
    }
}

fn make_delta(curr: Usage, prev: Option<Usage>) -> Usage {
    let prev = prev.unwrap_or_default();
    Usage {
        input_tokens: (curr.input_tokens - prev.input_tokens).max(0),
        cached_input_tokens: (curr.cached_input_tokens - prev.cached_input_tokens).max(0),
        output_tokens: (curr.output_tokens - prev.output_tokens).max(0),
        reasoning_output_tokens: (curr.reasoning_output_tokens - prev.reasoning_output_tokens)
            .max(0),
    }
}

fn is_zero(usage: Usage) -> bool {
    usage.input_tokens == 0
        && usage.cached_input_tokens == 0
        && usage.output_tokens == 0
        && usage.reasoning_output_tokens == 0
}

fn choose_session_label(state: &SessionState) -> String {
    if let Some(text) = &state.first_user_message {
        return shorten(Some(text), 120);
    }
    if let Some(cwd) = &state.cwd {
        return Path::new(cwd)
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or(cwd)
            .to_string();
    }
    "(untitled session)".to_string()
}

fn collect_snapshots_from_file(path: &Path, snapshots: &mut Vec<Snapshot>, stats: &mut ScanStats) {
    stats.files_scanned += 1;
    let mut state = SessionState::new(path.to_string_lossy().to_string());
    let mut saw_event = false;

    let mut scan = || -> Result<Vec<Snapshot>> {
        let file = fs::File::open(path)?;
        let reader = BufReader::new(file);
        let mut out = Vec::new();
        for line in reader.lines() {
            let line = line?;
            let Ok(obj) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let ts = parse_timestamp(obj.get("timestamp"));
            match obj.get("type").and_then(Value::as_str) {
                Some("session_meta") => {
                    if let Some(payload) = obj.get("payload") {
                        if let Some(id) = payload.get("id").and_then(Value::as_str) {
                            state.session_id = Some(id.to_string());
                        }
                        if let Some(source) = payload.get("source").and_then(Value::as_str) {
                            state.source = Some(source.to_string());
                        }
                        if let Some(cwd) = payload.get("cwd").and_then(Value::as_str) {
                            state.cwd = Some(cwd.to_string());
                        }
                        state.session_start = parse_timestamp(payload.get("timestamp")).or(ts);
                    }
                    continue;
                }
                Some("turn_context") => {
                    if let Some(payload) = obj.get("payload") {
                        if let Some(turn_id) = payload.get("turn_id").and_then(Value::as_str) {
                            state.current_turn_id = Some(turn_id.to_string());
                        }
                        if let Some(raw_model) = payload.get("model").and_then(Value::as_str) {
                            state.current_raw_model = raw_model.to_string();
                            state.current_model = normalize_model(raw_model);
                        }
                        if let Some(cwd) = payload.get("cwd").and_then(Value::as_str) {
                            state.cwd = Some(cwd.to_string());
                        }
                    }
                    continue;
                }
                _ => {}
            }

            if let Some(user_text) = extract_user_text(&obj) {
                let text = shorten(Some(&user_text), 160);
                if !text.is_empty() {
                    if state.first_user_message.is_none() {
                        state.first_user_message = Some(text.clone());
                        state.session_label = text.clone();
                    }
                    state.current_task_label = text;
                }
            }

            if obj.get("type").and_then(Value::as_str) != Some("event_msg") {
                continue;
            }
            let Some(payload) = obj.get("payload") else {
                continue;
            };
            if payload.get("type").and_then(Value::as_str) != Some("token_count") {
                continue;
            }
            let Some(info) = payload.get("info") else {
                continue;
            };
            let Some(total) = info.get("total_token_usage") else {
                continue;
            };
            let Some(ts) = ts else {
                continue;
            };

            state.token_events_seen += 1;
            saw_event = true;
            if state.session_label == "(untitled session)" {
                state.session_label = choose_session_label(&state);
            }
            out.push(Snapshot {
                ts,
                cumulative: usage_from_value(total),
                model: state.current_model.clone(),
                raw_model: state.current_raw_model.clone(),
                session_id: state.session_id.clone().unwrap_or_else(|| {
                    format!(
                        "missing:{}",
                        path.file_name().unwrap_or_default().to_string_lossy()
                    )
                }),
                session_label: state.session_label.clone(),
                session_path: state.file_path.clone(),
                turn_id: state
                    .current_turn_id
                    .clone()
                    .unwrap_or_else(|| format!("synthetic-{:06}", state.token_events_seen)),
                task_label: state.current_task_label.clone(),
                source: state.source.clone(),
                cwd: state.cwd.clone(),
            });
        }
        Ok(out)
    };

    match scan() {
        Ok(mut rows) => {
            stats.snapshots_seen += rows.len();
            if saw_event {
                stats.files_with_token_events += 1;
            }
            snapshots.append(&mut rows);
        }
        Err(err) => {
            stats.files_failed += 1;
            eprintln!("WARN failed to scan {}: {err}", path.display());
        }
    }
}

fn build_events_delta_global(snapshots: &[Snapshot], stats: &mut ScanStats) -> Vec<TokenEvent> {
    let mut by_session: HashMap<String, Vec<&Snapshot>> = HashMap::new();
    for snapshot in snapshots {
        by_session
            .entry(snapshot.session_id.clone())
            .or_default()
            .push(snapshot);
    }
    stats.sessions_seen = by_session.len();

    let mut events = Vec::new();
    for (_session_id, mut rows) in by_session {
        rows.sort_by(|a, b| {
            (
                a.ts,
                a.cumulative.raw_total_tokens(),
                a.cumulative.tuple4(),
                &a.session_path,
            )
                .cmp(&(
                    b.ts,
                    b.cumulative.raw_total_tokens(),
                    b.cumulative.tuple4(),
                    &b.session_path,
                ))
        });
        let mut seen: HashSet<(i64, i64, i64, i64)> = HashSet::new();
        let mut prev: Option<Usage> = None;
        let mut prev_raw = -1;
        for snapshot in rows {
            let sig = snapshot.cumulative.tuple4();
            if !seen.insert(sig) {
                stats.exact_duplicate_snapshots_dropped += 1;
                continue;
            }
            let curr_raw = snapshot.cumulative.raw_total_tokens();
            if prev.is_some() && curr_raw <= prev_raw {
                stats.replay_or_nonmonotonic_snapshots_dropped += 1;
                continue;
            }
            let delta = make_delta(snapshot.cumulative, prev);
            if is_zero(delta) {
                stats.zero_delta_snapshots_dropped += 1;
                prev = Some(snapshot.cumulative);
                prev_raw = curr_raw;
                continue;
            }
            events.push(TokenEvent {
                ts: snapshot.ts,
                usage: delta,
                model: snapshot.model.clone(),
                raw_model: snapshot.raw_model.clone(),
                session_id: snapshot.session_id.clone(),
                session_label: snapshot.session_label.clone(),
                session_path: snapshot.session_path.clone(),
                turn_id: snapshot.turn_id.clone(),
                task_label: snapshot.task_label.clone(),
                source: snapshot.source.clone(),
                cwd: snapshot.cwd.clone(),
            });
            prev = Some(snapshot.cumulative);
            prev_raw = curr_raw;
        }
    }
    events.sort_by(|a, b| {
        (&a.ts, &a.session_id, &a.turn_id).cmp(&(&b.ts, &b.session_id, &b.turn_id))
    });
    events
}

fn build_events_session_final(
    snapshots: &[Snapshot],
    stats: &mut ScanStats,
    start: Option<DateTime<Utc>>,
    end: Option<DateTime<Utc>>,
) -> Vec<TokenEvent> {
    let mut by_session: HashMap<String, Vec<&Snapshot>> = HashMap::new();
    for snapshot in snapshots {
        by_session
            .entry(snapshot.session_id.clone())
            .or_default()
            .push(snapshot);
    }
    stats.sessions_seen = by_session.len();
    let mut events = Vec::new();
    for (_session_id, rows) in by_session {
        let candidate = rows
            .into_iter()
            .filter(|s| start.is_none_or(|start| s.ts >= start))
            .filter(|s| end.is_none_or(|end| s.ts < end))
            .max_by_key(|s| (s.cumulative.raw_total_tokens(), s.ts));
        if let Some(snapshot) = candidate {
            events.push(TokenEvent {
                ts: snapshot.ts,
                usage: snapshot.cumulative,
                model: snapshot.model.clone(),
                raw_model: snapshot.raw_model.clone(),
                session_id: snapshot.session_id.clone(),
                session_label: snapshot.session_label.clone(),
                session_path: snapshot.session_path.clone(),
                turn_id: snapshot.turn_id.clone(),
                task_label: snapshot.task_label.clone(),
                source: snapshot.source.clone(),
                cwd: snapshot.cwd.clone(),
            });
        }
    }
    events.sort_by(|a, b| {
        (&a.ts, &a.session_id, &a.turn_id).cmp(&(&b.ts, &b.session_id, &b.turn_id))
    });
    events
}

fn collect_files(codex_home: &Path) -> Vec<PathBuf> {
    let mut roots = vec![
        codex_home.join("sessions"),
        codex_home.join("archived_sessions"),
    ];
    if let Ok(children) = fs::read_dir(codex_home) {
        let mut backups = children
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.is_dir()
                    && path
                        .file_name()
                        .and_then(|v| v.to_str())
                        .is_some_and(|name| name.starts_with("session-cwd-backup-"))
            })
            .collect::<Vec<_>>();
        backups.sort();
        for backup in backups {
            roots.push(backup.join("sessions"));
            roots.push(backup.join("archived_sessions"));
        }
    }

    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for root in roots {
        if !root.exists() {
            continue;
        }
        for entry in WalkDir::new(root).into_iter().flatten() {
            let path = entry.path();
            if !path.is_file() || path.extension().and_then(|v| v.to_str()) != Some("jsonl") {
                continue;
            }
            let key = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
            if seen.insert(key) {
                out.push(path.to_path_buf());
            }
        }
    }
    out.sort();
    out
}

fn rel_key(codex_home: &Path, path: &Path) -> String {
    path.strip_prefix(codex_home)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string()
}

fn metadata_sig(path: &Path) -> Result<(u64, u64)> {
    let meta = fs::metadata(path)?;
    let size = meta.len();
    let modified = meta.modified()?.duration_since(UNIX_EPOCH)?.as_nanos() as u64;
    Ok((size, modified))
}

fn file_content_hash(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0_u8; 1024 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn stable_cache_root(codex_home: &Path, timezone_name: &str) -> PathBuf {
    let home_sig = {
        let mut h = Sha256::new();
        h.update(codex_home.to_string_lossy().as_bytes());
        format!("{:x}", h.finalize())[..16].to_string()
    };
    let scope = {
        let mut h = Sha256::new();
        h.update(format!("{CACHE_VERSION}|delta-global|{timezone_name}|{home_sig}").as_bytes());
        format!("{:x}", h.finalize())[..16].to_string()
    };
    std::env::temp_dir()
        .join("ut-codex-usage-cache")
        .join(scope)
}

fn load_hash_index(cache_root: &Path) -> HashMap<String, HashEntry> {
    let path = cache_root.join("hash-index-rs.json");
    let Ok(text) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    let Ok(payload) = serde_json::from_str::<HashIndex>(&text) else {
        return HashMap::new();
    };
    if payload.version == CACHE_VERSION {
        payload.files
    } else {
        HashMap::new()
    }
}

fn save_hash_index(cache_root: &Path, index: &HashMap<String, HashEntry>) -> Result<()> {
    fs::create_dir_all(cache_root)?;
    let path = cache_root.join("hash-index-rs.json");
    let tmp = sibling_tmp_path(&path);
    let payload = HashIndex {
        version: CACHE_VERSION.to_string(),
        files: index.clone(),
    };
    fs::write(&tmp, serde_json::to_vec(&payload)?)?;
    fs::rename(tmp, path)?;
    Ok(())
}

fn sibling_tmp_path(path: &Path) -> PathBuf {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("tmp");
    path.with_file_name(format!("{}.{}.{}.tmp", file_name, std::process::id(), now))
}

fn cached_file_hash(
    codex_home: &Path,
    path: &Path,
    index: &mut HashMap<String, HashEntry>,
    cache_stats: &mut CacheStats,
) -> Result<String> {
    let rel = rel_key(codex_home, path);
    let (size, mtime_ns) = metadata_sig(path)?;
    if let Some(entry) = index.get(&rel) {
        if entry.size == size && entry.mtime_ns == mtime_ns {
            cache_stats.hash_hits += 1;
            return Ok(entry.content_sha256.clone());
        }
    }
    cache_stats.hash_misses += 1;
    let content_sha256 = file_content_hash(path)?;
    index.insert(
        rel,
        HashEntry {
            size,
            mtime_ns,
            content_sha256: content_sha256.clone(),
        },
    );
    Ok(content_sha256)
}

fn file_cache_path(
    cache_root: &Path,
    codex_home: &Path,
    path: &Path,
    content_hash: &str,
) -> PathBuf {
    let rel = rel_key(codex_home, path);
    let mut h = Sha256::new();
    h.update(rel.as_bytes());
    let key = format!("{:x}", h.finalize())[..16].to_string();
    cache_root
        .join("files-rs")
        .join(key)
        .join(format!("{content_hash}.json"))
}

fn read_snapshot_cache(cache_path: &Path, content_hash: &str) -> Result<Option<Vec<Snapshot>>> {
    if !cache_path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(cache_path)?;
    let payload = serde_json::from_str::<FileSnapshotCache>(&text)?;
    if payload.version != CACHE_VERSION || payload.content_sha256 != content_hash {
        return Ok(None);
    }
    Ok(Some(payload.snapshots))
}

fn write_snapshot_cache(
    cache_path: &Path,
    codex_home: &Path,
    path: &Path,
    content_hash: &str,
    snapshots: &[Snapshot],
) -> Result<()> {
    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let payload = FileSnapshotCache {
        version: CACHE_VERSION.to_string(),
        path: rel_key(codex_home, path),
        content_sha256: content_hash.to_string(),
        snapshots: snapshots.to_vec(),
    };
    let tmp = sibling_tmp_path(cache_path);
    fs::write(&tmp, serde_json::to_vec(&payload)?)?;
    fs::rename(tmp, cache_path)?;
    Ok(())
}

fn collect_snapshots_cached(
    files: &[PathBuf],
    codex_home: &Path,
    cache_root: &Path,
    stats: &mut ScanStats,
    cache_stats: &mut CacheStats,
) -> Vec<Snapshot> {
    let mut out = Vec::new();
    let mut index = load_hash_index(cache_root);
    for path in files {
        cache_stats.files_seen += 1;
        let content_hash = match cached_file_hash(codex_home, path, &mut index, cache_stats) {
            Ok(hash) => hash,
            Err(err) => {
                cache_stats.reason = Some(format!("hash failed: {err}"));
                continue;
            }
        };
        let cache_path = file_cache_path(cache_root, codex_home, path, &content_hash);
        match read_snapshot_cache(&cache_path, &content_hash) {
            Ok(Some(rows)) => {
                cache_stats.file_hits += 1;
                out.extend(rows);
            }
            _ => {
                cache_stats.file_misses += 1;
                let mut file_snapshots = Vec::new();
                collect_snapshots_from_file(path, &mut file_snapshots, stats);
                out.extend(file_snapshots.clone());
                if let Err(err) = write_snapshot_cache(
                    &cache_path,
                    codex_home,
                    path,
                    &content_hash,
                    &file_snapshots,
                ) {
                    cache_stats.reason = Some(format!("file cache write failed: {err}"));
                } else {
                    cache_stats.files_written += 1;
                }
            }
        }
    }
    if let Err(err) = save_hash_index(cache_root, &index) {
        cache_stats.reason = Some(format!("hash index write failed: {err}"));
    }
    cache_stats.used = cache_stats.file_hits > 0;
    cache_stats.rebuilt = cache_stats.file_misses > 0;
    out
}

fn local_day_key(ts: DateTime<Utc>, tz: &TimezoneChoice) -> String {
    match tz {
        TimezoneChoice::Local => ts.with_timezone(&Local).date_naive().to_string(),
        TimezoneChoice::Iana(zone) => ts.with_timezone(zone).date_naive().to_string(),
    }
}

fn local_week_key(ts: DateTime<Utc>, tz: &TimezoneChoice) -> String {
    let date = match tz {
        TimezoneChoice::Local => ts.with_timezone(&Local).date_naive(),
        TimezoneChoice::Iana(zone) => ts.with_timezone(zone).date_naive(),
    };
    let iso = date.iso_week();
    format!("{}-W{:02}", iso.year(), iso.week())
}

fn emit_event(
    event: &TokenEvent,
    agg: &mut Aggregator,
    pb: &PriceBook,
    start: Option<DateTime<Utc>>,
    end: Option<DateTime<Utc>>,
    tz: &TimezoneChoice,
) {
    if start.is_some_and(|start| event.ts < start) || end.is_some_and(|end| event.ts >= end) {
        return;
    }
    let (credits, usd) = pb.price_usage(&event.model, event.usage, &event.raw_model);
    let day_key = local_day_key(event.ts, tz);
    let week_key = local_week_key(event.ts, tz);
    agg.add_event(event, credits, usd, day_key, week_key);
}

impl Aggregator {
    fn add_event(
        &mut self,
        event: &TokenEvent,
        credits: f64,
        usd: f64,
        day_key: String,
        week_key: String,
    ) {
        self.events_counted += 1;
        self.overall.add(event.usage);

        let sr = self
            .session_rows
            .entry(event.session_id.clone())
            .or_insert_with(|| AggregateRecord {
                key: event.session_id.clone(),
                meta: BTreeMap::from([
                    ("label".to_string(), event.session_label.clone()),
                    ("path".to_string(), event.session_path.clone()),
                    (
                        "source".to_string(),
                        event.source.clone().unwrap_or_default(),
                    ),
                    ("cwd".to_string(), event.cwd.clone().unwrap_or_default()),
                    ("first_seen".to_string(), event.ts.to_rfc3339()),
                ]),
                ..AggregateRecord::default()
            });
        sr.usage.add(event.usage);
        sr.credits += credits;
        sr.usd += usd;
        *sr.models.entry(event.model.clone()).or_default() += event.usage.raw_total_tokens();
        sr.meta
            .insert("last_seen".to_string(), event.ts.to_rfc3339());

        let task_key = (event.session_id.clone(), event.turn_id.clone());
        let tr = self
            .task_rows
            .entry(task_key)
            .or_insert_with(|| AggregateRecord {
                key: format!("{}:{}", event.session_id, event.turn_id),
                meta: BTreeMap::from([
                    ("session_id".to_string(), event.session_id.clone()),
                    ("turn_id".to_string(), event.turn_id.clone()),
                    ("label".to_string(), event.task_label.clone()),
                    ("session_label".to_string(), event.session_label.clone()),
                    ("path".to_string(), event.session_path.clone()),
                    (
                        "source".to_string(),
                        event.source.clone().unwrap_or_default(),
                    ),
                    ("cwd".to_string(), event.cwd.clone().unwrap_or_default()),
                    ("first_seen".to_string(), event.ts.to_rfc3339()),
                ]),
                ..AggregateRecord::default()
            });
        tr.usage.add(event.usage);
        tr.credits += credits;
        tr.usd += usd;
        *tr.models.entry(event.model.clone()).or_default() += event.usage.raw_total_tokens();
        tr.meta
            .insert("last_seen".to_string(), event.ts.to_rfc3339());

        let dr = self
            .day_rows
            .entry(day_key.clone())
            .or_insert_with(|| AggregateRecord {
                key: day_key.clone(),
                meta: BTreeMap::from([("day".to_string(), day_key.clone())]),
                ..AggregateRecord::default()
            });
        dr.usage.add(event.usage);
        dr.credits += credits;
        dr.usd += usd;
        *dr.models.entry(event.model.clone()).or_default() += event.usage.raw_total_tokens();

        let wr = self
            .week_rows
            .entry(week_key.clone())
            .or_insert_with(|| AggregateRecord {
                key: week_key.clone(),
                meta: BTreeMap::from([("week".to_string(), week_key.clone())]),
                ..AggregateRecord::default()
            });
        wr.usage.add(event.usage);
        wr.credits += credits;
        wr.usd += usd;
        *wr.models.entry(event.model.clone()).or_default() += event.usage.raw_total_tokens();

        let mr = self
            .model_rows
            .entry(event.model.clone())
            .or_insert_with(|| AggregateRecord {
                key: event.model.clone(),
                meta: BTreeMap::from([("model".to_string(), event.model.clone())]),
                ..AggregateRecord::default()
            });
        mr.usage.add(event.usage);
        mr.credits += credits;
        mr.usd += usd;
        *mr.models.entry(event.model.clone()).or_default() += event.usage.raw_total_tokens();
    }
}

impl PriceBook {
    fn new(args: &Args) -> Self {
        Self {
            mode: args.pricing_mode.clone(),
            usd_per_credit: args.usd_per_1000_credits / 1000.0,
            region_uplift: args.api_region_uplift,
            fast_credit_multiplier: args.fast_credit_multiplier,
        }
    }

    fn rates(&self, model: &str, raw_model: &str) -> Option<(f64, f64, f64)> {
        if self.mode == "credits" {
            let mut rates = match model {
                "gpt-5.5" => (125.0, 12.50, 750.0),
                "gpt-5.4" => (62.50, 6.250, 375.0),
                "gpt-5.4-mini" => (18.75, 1.875, 113.0),
                "gpt-5.3-codex" | "gpt-5.2" | "codex-auto-review" => (43.75, 4.375, 350.0),
                _ => return None,
            };
            if let Some(multiplier) = self.fast_credit_multiplier {
                if raw_model.to_ascii_lowercase().contains("fast") {
                    rates.0 *= multiplier;
                    rates.1 *= multiplier;
                    rates.2 *= multiplier;
                }
            }
            return Some(rates);
        }
        let rates = match (self.mode.as_str(), model) {
            ("api-standard-short", "gpt-5.5") => (5.00, 0.50, 30.00),
            ("api-standard-short", "gpt-5.4") => (2.50, 0.25, 15.00),
            ("api-standard-short", "gpt-5.4-mini") => (0.75, 0.075, 4.50),
            ("api-standard-short", "gpt-5.3-codex" | "codex-auto-review") => (1.75, 0.175, 14.00),
            ("api-priority-short", "gpt-5.5") => (12.50, 1.25, 75.00),
            ("api-priority-short", "gpt-5.4") => (5.00, 0.50, 30.00),
            ("api-priority-short", "gpt-5.4-mini") => (1.50, 0.15, 9.00),
            ("api-priority-short", "gpt-5.3-codex" | "codex-auto-review") => (3.50, 0.35, 28.00),
            _ => return None,
        };
        Some(rates)
    }

    fn price_usage(&self, model: &str, usage: Usage, raw_model: &str) -> (f64, f64) {
        let Some((input_rate, cached_rate, output_rate)) = self.rates(model, raw_model) else {
            return (0.0, 0.0);
        };
        let mut value = usage.uncached_input_tokens() as f64 / 1_000_000.0 * input_rate;
        value += usage.cached_input_tokens as f64 / 1_000_000.0 * cached_rate;
        value += usage.output_tokens as f64 / 1_000_000.0 * output_rate;
        if self.mode.starts_with("api") {
            (0.0, value * self.region_uplift)
        } else {
            (value, value * self.usd_per_credit)
        }
    }
}

fn aggregate_events(
    events: &[TokenEvent],
    pb: &PriceBook,
    start: Option<DateTime<Utc>>,
    end: Option<DateTime<Utc>>,
    tz: &TimezoneChoice,
) -> Aggregator {
    let mut agg = Aggregator::default();
    for event in events {
        emit_event(event, &mut agg, pb, start, end, tz);
    }
    agg
}

fn dominant_model(models: &HashMap<String, i64>) -> String {
    models
        .iter()
        .max_by_key(|(_, value)| **value)
        .map(|(key, _)| key.clone())
        .unwrap_or_else(|| "unknown".to_string())
}

fn scale_aggregate(agg: &Aggregator, factor: f64, pb: &PriceBook) -> Aggregator {
    let mut out = Aggregator::default();
    for (key, rec) in &agg.session_rows {
        let model = dominant_model(&rec.models);
        let usage = rec.usage.scaled(factor);
        let (credits, usd) = pb.price_usage(&model, usage, &model);
        out.session_rows.insert(
            key.clone(),
            AggregateRecord {
                key: rec.key.clone(),
                usage,
                credits,
                usd,
                meta: rec.meta.clone(),
                models: HashMap::from([(model, usage.raw_total_tokens())]),
            },
        );
    }
    for (key, rec) in &agg.task_rows {
        let model = dominant_model(&rec.models);
        let usage = rec.usage.scaled(factor);
        let (credits, usd) = pb.price_usage(&model, usage, &model);
        out.task_rows.insert(
            key.clone(),
            AggregateRecord {
                key: rec.key.clone(),
                usage,
                credits,
                usd,
                meta: rec.meta.clone(),
                models: HashMap::from([(model, usage.raw_total_tokens())]),
            },
        );
    }
    for (key, rec) in &agg.day_rows {
        let model = dominant_model(&rec.models);
        let usage = rec.usage.scaled(factor);
        let (credits, usd) = pb.price_usage(&model, usage, &model);
        out.day_rows.insert(
            key.clone(),
            AggregateRecord {
                key: rec.key.clone(),
                usage,
                credits,
                usd,
                meta: rec.meta.clone(),
                models: HashMap::from([(model, usage.raw_total_tokens())]),
            },
        );
    }
    for (key, rec) in &agg.week_rows {
        let model = dominant_model(&rec.models);
        let usage = rec.usage.scaled(factor);
        let (credits, usd) = pb.price_usage(&model, usage, &model);
        out.week_rows.insert(
            key.clone(),
            AggregateRecord {
                key: rec.key.clone(),
                usage,
                credits,
                usd,
                meta: rec.meta.clone(),
                models: HashMap::from([(model, usage.raw_total_tokens())]),
            },
        );
    }
    for (key, rec) in &agg.model_rows {
        let model = dominant_model(&rec.models);
        let usage = rec.usage.scaled(factor);
        let (credits, usd) = pb.price_usage(&model, usage, &model);
        out.model_rows.insert(
            key.clone(),
            AggregateRecord {
                key: rec.key.clone(),
                usage,
                credits,
                usd,
                meta: rec.meta.clone(),
                models: HashMap::from([(model, usage.raw_total_tokens())]),
            },
        );
    }
    out.overall = agg.overall.scaled(factor);
    out.events_counted = agg.events_counted;
    out
}

fn sort_rows<'a>(
    rows: impl Iterator<Item = &'a AggregateRecord>,
    limit: usize,
) -> Vec<&'a AggregateRecord> {
    let mut out = rows.collect::<Vec<_>>();
    out.sort_by_key(|row| Reverse(row.sort_metric()));
    out.truncate(limit);
    out
}

fn build_json(
    agg: &Aggregator,
    stats: &ScanStats,
    cache_stats: &CacheStats,
    args: &Args,
    timezone_name: &str,
    start: Option<DateTime<Utc>>,
    end: Option<DateTime<Utc>>,
) -> Value {
    json!({
        "range": {
            "from": start.map(|v| v.to_rfc3339()),
            "to": end.map(|v| v.to_rfc3339()),
            "timezone": timezone_name,
        },
        "count_mode": args.count_mode,
        "pricing_mode": args.pricing_mode,
        "pricing": {
            "usd_per_1000_credits": args.usd_per_1000_credits,
            "api_region_uplift": args.api_region_uplift,
            "fast_credit_multiplier": args.fast_credit_multiplier,
            "profile_total": args.profile_total,
            "profile_basis": args.profile_basis,
        },
        "cache": {
            "enabled": cache_stats.enabled,
            "used": cache_stats.used,
            "rebuilt": cache_stats.rebuilt,
            "files_seen": cache_stats.files_seen,
            "hash_hits": cache_stats.hash_hits,
            "hash_misses": cache_stats.hash_misses,
            "file_hits": cache_stats.file_hits,
            "file_misses": cache_stats.file_misses,
            "files_written": cache_stats.files_written,
            "cache_dir": cache_stats.cache_dir.as_ref().map(|p| p.to_string_lossy().to_string()),
            "reason": cache_stats.reason,
        },
        "summary": {
            "input_tokens": agg.overall.input_tokens,
            "cached_input_tokens": agg.overall.cached_input_tokens,
            "uncached_input_tokens": agg.overall.uncached_input_tokens(),
            "output_tokens": agg.overall.output_tokens,
            "reasoning_output_tokens": agg.overall.reasoning_output_tokens,
            "raw_total_tokens": agg.overall.raw_total_tokens(),
            "cli_display_total": agg.overall.cli_display_total(),
            "credits": agg.model_rows.values().map(|r| r.credits).sum::<f64>(),
            "usd": agg.model_rows.values().map(|r| r.usd).sum::<f64>(),
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
        "top_sessions": sort_rows(agg.session_rows.values(), args.top).into_iter().map(AggregateRecord::to_json).collect::<Vec<_>>(),
        "top_tasks": sort_rows(agg.task_rows.values(), args.top).into_iter().map(AggregateRecord::to_json).collect::<Vec<_>>(),
        "top_days": sort_rows(agg.day_rows.values(), args.top).into_iter().map(AggregateRecord::to_json).collect::<Vec<_>>(),
        "top_weeks": sort_rows(agg.week_rows.values(), args.top).into_iter().map(AggregateRecord::to_json).collect::<Vec<_>>(),
        "top_models": sort_rows(agg.model_rows.values(), args.top).into_iter().map(AggregateRecord::to_json).collect::<Vec<_>>(),
    })
}

fn styled_cell(text: impl ToString, color: Color, bold: bool) -> Cell {
    let cell = Cell::new(text.to_string()).fg(color);
    if bold {
        cell.add_attribute(Attribute::Bold)
    } else {
        cell
    }
}

fn block_width(block: &str) -> usize {
    block
        .lines()
        .map(measure_text_width)
        .max()
        .unwrap_or_default()
}

fn pad_line(line: &str, width: usize) -> String {
    let visible = measure_text_width(line);
    format!("{line}{}", " ".repeat(width.saturating_sub(visible)))
}

fn render_columns(blocks: &[String], gap: usize) -> String {
    let split_blocks = blocks
        .iter()
        .map(|block| block.lines().collect::<Vec<_>>())
        .collect::<Vec<_>>();
    let widths = blocks
        .iter()
        .map(|block| block_width(block))
        .collect::<Vec<_>>();
    let height = split_blocks.iter().map(Vec::len).max().unwrap_or_default();
    let spacer = " ".repeat(gap);
    let mut out = Vec::new();
    for row_idx in 0..height {
        let mut line = String::new();
        for (block_idx, lines) in split_blocks.iter().enumerate() {
            if block_idx > 0 {
                line.push_str(&spacer);
            }
            let cell = lines.get(row_idx).copied().unwrap_or_default();
            line.push_str(&pad_line(cell, widths[block_idx]));
        }
        out.push(line.trim_end().to_string());
    }
    out.join("\n")
}

fn terminal_width() -> usize {
    if let Ok(columns) = std::env::var("COLUMNS") {
        if let Ok(columns) = columns.parse::<usize>() {
            return columns;
        }
    }
    Term::stdout()
        .size_checked()
        .map(|(_, columns)| columns as usize)
        .unwrap_or(100)
}

fn print_block_group(blocks: Vec<String>) {
    let blocks = blocks
        .into_iter()
        .filter(|block| !block.trim().is_empty())
        .collect::<Vec<_>>();
    if blocks.is_empty() {
        return;
    }
    let gap = 4;
    let needed_width = blocks.iter().map(|block| block_width(block)).sum::<usize>()
        + gap * blocks.len().saturating_sub(1);
    if blocks.len() > 1 && needed_width <= terminal_width() {
        println!("{}", render_columns(&blocks, gap));
    } else {
        for block in blocks {
            println!("{block}");
        }
    }
}

fn table_block(title: &str, table: Table) -> String {
    format!("{}\n{table}", style(title).cyan().bold())
}

fn metric_table(_title: &str, rows: Vec<(&str, String, String)>, _border_color: Color) -> Table {
    let mut table = Table::new();
    table
        .load_preset(UTF8_FULL)
        .set_content_arrangement(ContentArrangement::Dynamic)
        .set_header(vec![
            styled_cell("metric", Color::Cyan, true),
            styled_cell("value", Color::White, true),
            styled_cell("short", Color::DarkGrey, true),
        ]);
    for (metric, value, short) in rows {
        table.add_row(vec![
            styled_cell(metric, Color::Cyan, false),
            styled_cell(value, Color::White, true),
            styled_cell(short, Color::DarkGrey, false),
        ]);
    }
    table.enforce_styling();
    table.apply_modifier(comfy_table::modifiers::UTF8_ROUND_CORNERS);
    table
}

fn range_panel_block(
    start: Option<DateTime<Utc>>,
    end: Option<DateTime<Utc>>,
    args: &Args,
    factor: Option<f64>,
) -> String {
    let mut table = Table::new();
    table
        .load_preset(UTF8_FULL)
        .apply_modifier(comfy_table::modifiers::UTF8_ROUND_CORNERS)
        .set_content_arrangement(ContentArrangement::Dynamic);
    table.add_row(vec![
        styled_cell("from", Color::DarkGrey, false),
        styled_cell(
            start
                .map(|v| v.to_rfc3339())
                .unwrap_or_else(|| "(beginning)".to_string()),
            Color::White,
            true,
        ),
    ]);
    table.add_row(vec![
        styled_cell("to", Color::DarkGrey, false),
        styled_cell(
            end.map(|v| v.to_rfc3339())
                .unwrap_or_else(|| "(end)".to_string()),
            Color::White,
            true,
        ),
    ]);
    table.add_row(vec![
        styled_cell("mode", Color::DarkGrey, false),
        styled_cell(&args.count_mode, Color::White, true),
    ]);
    if let Some(factor) = factor {
        table.add_row(vec![
            styled_cell("profile", Color::DarkGrey, false),
            styled_cell(
                format!(
                    "{} on {}, x{factor:.6}",
                    format_int(args.profile_total.unwrap_or_default().round() as i64),
                    args.profile_basis
                ),
                Color::Yellow,
                true,
            ),
        ]);
    }
    table_block("Codex Usage", table)
}

fn profile_comparison_block(profile: &BTreeMap<String, f64>, args: &Args) -> String {
    let table = metric_table(
        "Profile comparison",
        vec![
            (
                "profile_total",
                format_int(args.profile_total.unwrap_or_default().round() as i64),
                human_tokens(args.profile_total.unwrap_or_default().round() as i64),
            ),
            (
                "local_log_total",
                format_int(profile["local_basis_total"].round() as i64),
                human_tokens(profile["local_basis_total"].round() as i64),
            ),
            (
                "local_log_coverage",
                format!("{:.1}%", profile["local_coverage"] * 100.0),
                String::new(),
            ),
            (
                "unavailable_in_logs",
                format_int(profile["unavailable_total"].round() as i64),
                human_tokens(profile["unavailable_total"].round() as i64),
            ),
        ],
        Color::Yellow,
    );
    table_block("Profile comparison", table)
}

fn summary_blocks(agg: &Aggregator, args: &Args, title: &str) -> Vec<String> {
    let u = agg.overall;
    let usage_table = metric_table(
        title,
        vec![
            (
                "input_tokens",
                format_int(u.input_tokens),
                human_tokens(u.input_tokens),
            ),
            (
                "cached_input_tokens",
                format_int(u.cached_input_tokens),
                human_tokens(u.cached_input_tokens),
            ),
            (
                "uncached_input_tokens",
                format_int(u.uncached_input_tokens()),
                human_tokens(u.uncached_input_tokens()),
            ),
            (
                "output_tokens",
                format_int(u.output_tokens),
                human_tokens(u.output_tokens),
            ),
            (
                "reasoning_output_tokens",
                format_int(u.reasoning_output_tokens),
                human_tokens(u.reasoning_output_tokens),
            ),
            (
                "raw_total_tokens",
                format_int(u.raw_total_tokens()),
                human_tokens(u.raw_total_tokens()),
            ),
            (
                "cli_display_total",
                format_int(u.cli_display_total()),
                human_tokens(u.cli_display_total()),
            ),
        ],
        Color::Cyan,
    );

    let credits = agg.model_rows.values().map(|r| r.credits).sum::<f64>();
    let usd = agg.model_rows.values().map(|r| r.usd).sum::<f64>();
    let cost_rows = if args.pricing_mode == "credits" {
        vec![
            ("credits", human_credits(credits), String::new()),
            (
                "usd",
                human_money(usd),
                format!(
                    "@ {} / 1000 credits",
                    human_money(args.usd_per_1000_credits)
                ),
            ),
        ]
    } else {
        vec![("usd", human_money(usd), args.pricing_mode.clone())]
    };
    let cost_table = metric_table("Estimated cost", cost_rows, Color::Green);
    vec![
        table_block(title, usage_table),
        table_block("Estimated cost", cost_table),
    ]
}

fn cache_block(cache_stats: &CacheStats) -> String {
    if !cache_stats.enabled {
        return format!(
            "{}",
            style(format!(
                "Cache disabled: {}",
                cache_stats.reason.clone().unwrap_or_default()
            ))
            .yellow()
        );
    }
    let status = if cache_stats.used {
        "hit"
    } else if cache_stats.rebuilt {
        "rebuilt"
    } else {
        "miss"
    };
    let mut rows = vec![
        ("status", status.to_string(), String::new()),
        (
            "files_seen",
            format_int(cache_stats.files_seen as i64),
            String::new(),
        ),
        (
            "hash_hits",
            format_int(cache_stats.hash_hits as i64),
            String::new(),
        ),
        (
            "hash_misses",
            format_int(cache_stats.hash_misses as i64),
            String::new(),
        ),
        (
            "file_hits",
            format_int(cache_stats.file_hits as i64),
            String::new(),
        ),
        (
            "file_misses",
            format_int(cache_stats.file_misses as i64),
            String::new(),
        ),
        (
            "files_written",
            format_int(cache_stats.files_written as i64),
            String::new(),
        ),
    ];
    if let Some(reason) = &cache_stats.reason {
        rows.push(("note", reason.clone(), String::new()));
    }
    let table = metric_table("Cache", rows, Color::Green);
    table_block("Cache", table)
}

fn scan_stats_block(stats: &ScanStats, events_counted: usize) -> String {
    let table = metric_table(
        "Scan stats",
        vec![
            (
                "files_scanned",
                format_int(stats.files_scanned as i64),
                String::new(),
            ),
            (
                "files_with_token_events",
                format_int(stats.files_with_token_events as i64),
                String::new(),
            ),
            (
                "files_failed",
                format_int(stats.files_failed as i64),
                String::new(),
            ),
            (
                "snapshots_seen",
                format_int(stats.snapshots_seen as i64),
                String::new(),
            ),
            (
                "sessions_seen",
                format_int(stats.sessions_seen as i64),
                String::new(),
            ),
            (
                "token_events_counted",
                format_int(events_counted as i64),
                String::new(),
            ),
            (
                "exact_duplicate_snapshots_dropped",
                format_int(stats.exact_duplicate_snapshots_dropped as i64),
                String::new(),
            ),
            (
                "replay_or_nonmonotonic_snapshots_dropped",
                format_int(stats.replay_or_nonmonotonic_snapshots_dropped as i64),
                String::new(),
            ),
            (
                "zero_delta_snapshots_dropped",
                format_int(stats.zero_delta_snapshots_dropped as i64),
                String::new(),
            ),
        ],
        Color::DarkGrey,
    );
    table_block("Scan stats", table)
}

fn print_top_table(title: &str, rows: Vec<&AggregateRecord>, kind: &str) {
    if rows.is_empty() {
        let table = metric_table(
            title,
            vec![("rows", "(none)".to_string(), String::new())],
            Color::DarkGrey,
        );
        println!("{}", table_block(title, table));
        return;
    }
    let mut table = Table::new();
    table
        .load_preset(UTF8_FULL)
        .apply_modifier(comfy_table::modifiers::UTF8_ROUND_CORNERS)
        .set_content_arrangement(ContentArrangement::Dynamic);
    if kind == "session" {
        table.set_header(vec![
            styled_cell("#", Color::DarkGrey, true),
            styled_cell("session", Color::Cyan, true),
            styled_cell("model", Color::Magenta, true),
            styled_cell("raw", Color::Cyan, true),
            styled_cell("usd", Color::Green, true),
            styled_cell("label", Color::White, true),
        ]);
        for (idx, row) in rows.iter().enumerate() {
            table.add_row(vec![
                styled_cell(idx + 1, Color::DarkGrey, false),
                styled_cell(shorten(Some(&row.key), 10), Color::Cyan, false),
                styled_cell(dominant_model(&row.models), Color::Magenta, false),
                styled_cell(
                    human_tokens(row.usage.raw_total_tokens()),
                    Color::Cyan,
                    true,
                ),
                styled_cell(human_money(row.usd), Color::Green, true),
                styled_cell(
                    shorten(row.meta.get("label").map(String::as_str), 80),
                    Color::White,
                    false,
                ),
            ]);
        }
    } else if kind == "task" {
        table.set_header(vec![
            styled_cell("#", Color::DarkGrey, true),
            styled_cell("session", Color::Cyan, true),
            styled_cell("turn", Color::DarkGrey, true),
            styled_cell("model", Color::Magenta, true),
            styled_cell("raw", Color::Cyan, true),
            styled_cell("usd", Color::Green, true),
            styled_cell("label", Color::White, true),
        ]);
        for (idx, row) in rows.iter().enumerate() {
            table.add_row(vec![
                styled_cell(idx + 1, Color::DarkGrey, false),
                styled_cell(
                    shorten(row.meta.get("session_id").map(String::as_str), 10),
                    Color::Cyan,
                    false,
                ),
                styled_cell(
                    shorten(row.meta.get("turn_id").map(String::as_str), 10),
                    Color::DarkGrey,
                    false,
                ),
                styled_cell(dominant_model(&row.models), Color::Magenta, false),
                styled_cell(
                    human_tokens(row.usage.raw_total_tokens()),
                    Color::Cyan,
                    true,
                ),
                styled_cell(human_money(row.usd), Color::Green, true),
                styled_cell(
                    shorten(row.meta.get("label").map(String::as_str), 80),
                    Color::White,
                    false,
                ),
            ]);
        }
    } else {
        table.set_header(vec![
            styled_cell("#", Color::DarkGrey, true),
            styled_cell(kind, Color::Cyan, true),
            styled_cell("raw", Color::Cyan, true),
            styled_cell("input", Color::Blue, true),
            styled_cell("cached", Color::Green, true),
            styled_cell("uncached", Color::Yellow, true),
            styled_cell("output", Color::Magenta, true),
            styled_cell("usd", Color::Green, true),
        ]);
        for (idx, row) in rows.iter().enumerate() {
            table.add_row(vec![
                styled_cell(idx + 1, Color::DarkGrey, false),
                styled_cell(&row.key, Color::Cyan, false),
                styled_cell(
                    human_tokens(row.usage.raw_total_tokens()),
                    Color::Cyan,
                    true,
                ),
                styled_cell(human_tokens(row.usage.input_tokens), Color::Blue, false),
                styled_cell(
                    human_tokens(row.usage.cached_input_tokens),
                    Color::Green,
                    false,
                ),
                styled_cell(
                    human_tokens(row.usage.uncached_input_tokens()),
                    Color::Yellow,
                    false,
                ),
                styled_cell(human_tokens(row.usage.output_tokens), Color::Magenta, false),
                styled_cell(human_money(row.usd), Color::Green, true),
            ]);
        }
    }
    println!("{}", table_block(title, table));
}

fn generate_report(args: Args) -> Result<GeneratedReport> {
    let tz = parse_timezone(args.timezone.as_deref())?;
    let timezone_name = timezone_label(args.timezone.as_deref(), &tz);
    let is_all = args.range.as_deref() == Some("all");
    if args.range.as_deref().is_some_and(|value| value != "all") {
        return Err(anyhow!(
            "unsupported positional argument; use `all` or date flags"
        ));
    }

    let mut start = parse_bound(args.date_from.as_deref(), &tz, false)?;
    let end = parse_bound(args.date_to.as_deref(), &tz, true)?;
    if !is_all && start.is_none() && end.is_none() {
        start = Some(default_month_start(&tz)?);
    }

    if !args.codex_home.exists() {
        return Err(anyhow!(
            "Codex home does not exist: {}",
            args.codex_home.display()
        ));
    }
    let files = collect_files(&args.codex_home);
    if files.is_empty() {
        return Err(anyhow!(
            "No JSONL files found under {}/sessions or {}/archived_sessions",
            args.codex_home.display(),
            args.codex_home.display()
        ));
    }

    let pb = PriceBook::new(&args);
    let mut stats = ScanStats::default();
    let mut cache_stats = CacheStats::default();
    let events = if args.count_mode == "delta-global" {
        let cache_root = stable_cache_root(&args.codex_home, &timezone_name);
        cache_stats.cache_dir = Some(cache_root.clone());
        let snapshots = collect_snapshots_cached(
            &files,
            &args.codex_home,
            &cache_root,
            &mut stats,
            &mut cache_stats,
        );
        build_events_delta_global(&snapshots, &mut stats)
    } else {
        cache_stats.enabled = false;
        cache_stats.reason = Some("session-final mode does not use file cache".to_string());
        let mut snapshots = Vec::new();
        for file in &files {
            collect_snapshots_from_file(file, &mut snapshots, &mut stats);
        }
        build_events_session_final(&snapshots, &mut stats, start, end)
    };
    let mut agg = if args.count_mode == "delta-global" {
        aggregate_events(&events, &pb, start, end, &tz)
    } else {
        aggregate_events(&events, &pb, None, None, &tz)
    };

    let mut profile_comparison: Option<BTreeMap<String, f64>> = None;
    let mut factor = None;
    if let Some(profile_total) = args.profile_total {
        if profile_total <= 0.0 {
            return Err(anyhow!("--profile-total must be greater than zero"));
        }
        let basis = if args.profile_basis == "raw" {
            agg.overall.raw_total_tokens()
        } else {
            agg.overall.cli_display_total()
        };
        if basis <= 0 {
            return Err(anyhow!(
                "--profile-total was set, but the selected profile basis is zero"
            ));
        }
        let scale = profile_total / basis as f64;
        profile_comparison = Some(BTreeMap::from([
            ("profile_total".to_string(), profile_total),
            ("local_basis_total".to_string(), basis as f64),
            ("local_coverage".to_string(), basis as f64 / profile_total),
            (
                "unavailable_total".to_string(),
                (profile_total - basis as f64).max(0.0),
            ),
        ]));
        agg = scale_aggregate(&agg, scale, &pb);
        factor = Some(scale);
    }

    Ok(GeneratedReport {
        args,
        agg,
        stats,
        cache_stats,
        timezone_name,
        start,
        end,
        profile_comparison,
        factor,
    })
}

fn report_json(report: &GeneratedReport) -> Value {
    let mut out = build_json(
        &report.agg,
        &report.stats,
        &report.cache_stats,
        &report.args,
        &report.timezone_name,
        report.start,
        report.end,
    );
    if let Some(scale) = report.factor {
        out["profile_scaling_factor"] = json!(scale);
        out["profile_comparison"] = json!(report.profile_comparison);
    }
    out
}

fn print_report(report: &GeneratedReport) {
    let mut overview_blocks = vec![range_panel_block(
        report.start,
        report.end,
        &report.args,
        report.factor,
    )];
    if let Some(profile) = &report.profile_comparison {
        overview_blocks.push(profile_comparison_block(profile, &report.args));
    }
    print_block_group(overview_blocks);
    print_block_group(summary_blocks(
        &report.agg,
        &report.args,
        if report.factor.is_some() {
            "Usage summary (profile-scaled estimate)"
        } else {
            "Usage summary"
        },
    ));
    print_block_group(vec![
        cache_block(&report.cache_stats),
        scan_stats_block(&report.stats, report.agg.events_counted),
    ]);
    print_top_table(
        "Top sessions",
        sort_rows(report.agg.session_rows.values(), report.args.top),
        "session",
    );
    print_top_table(
        "Top tasks",
        sort_rows(report.agg.task_rows.values(), report.args.top),
        "task",
    );
    print_top_table(
        "Top days",
        sort_rows(report.agg.day_rows.values(), report.args.top),
        "day",
    );
    print_top_table(
        "Top weeks",
        sort_rows(report.agg.week_rows.values(), report.args.top),
        "week",
    );
    print_top_table(
        "Top models",
        sort_rows(report.agg.model_rows.values(), report.args.top),
        "model",
    );
}

fn install_surface() -> String {
    let Ok(exe) = std::env::current_exe() else {
        return "unknown".to_string();
    };
    let path = exe.to_string_lossy();
    if path.contains(".app/Contents/MacOS/") {
        "macOS app bundle".to_string()
    } else {
        "standalone binary".to_string()
    }
}

fn doctor_json(args: &Args) -> Result<Value> {
    let tz = parse_timezone(args.timezone.as_deref())?;
    let timezone_name = timezone_label(args.timezone.as_deref(), &tz);
    let sessions_dir = args.codex_home.join("sessions");
    let archived_sessions_dir = args.codex_home.join("archived_sessions");
    let cache_dir = stable_cache_root(&args.codex_home, &timezone_name);
    let files = if args.codex_home.exists() {
        collect_files(&args.codex_home)
    } else {
        Vec::new()
    };

    Ok(json!({
        "tool": "ut-codex-usage",
        "version": env!("CARGO_PKG_VERSION"),
        "install_surface": install_surface(),
        "codex_home": args.codex_home,
        "codex_home_exists": args.codex_home.exists(),
        "sessions_dir": sessions_dir,
        "sessions_dir_exists": sessions_dir.exists(),
        "archived_sessions_dir": archived_sessions_dir,
        "archived_sessions_dir_exists": archived_sessions_dir.exists(),
        "jsonl_files": files.len(),
        "cache_dir": cache_dir,
        "cache_dir_exists": cache_dir.exists(),
        "timezone": timezone_name,
        "count_mode": args.count_mode,
        "pricing_mode": args.pricing_mode,
        "usd_per_1000_credits": args.usd_per_1000_credits,
    }))
}

fn bool_label(value: bool) -> &'static str {
    if value {
        "ok"
    } else {
        "missing"
    }
}

fn print_doctor(args: &Args) -> Result<()> {
    let payload = doctor_json(args)?;
    let mut table = Table::new();
    table
        .load_preset(UTF8_FULL)
        .apply_modifier(comfy_table::modifiers::UTF8_ROUND_CORNERS)
        .set_content_arrangement(ContentArrangement::Dynamic)
        .set_header(vec![
            styled_cell("check", Color::Cyan, true),
            styled_cell("status", Color::White, true),
            styled_cell("detail", Color::DarkGrey, true),
        ]);

    let codex_home_exists = payload["codex_home_exists"].as_bool().unwrap_or(false);
    let sessions_dir_exists = payload["sessions_dir_exists"].as_bool().unwrap_or(false);
    let archived_sessions_dir_exists = payload["archived_sessions_dir_exists"]
        .as_bool()
        .unwrap_or(false);
    let cache_dir_exists = payload["cache_dir_exists"].as_bool().unwrap_or(false);
    let jsonl_files = payload["jsonl_files"].as_u64().unwrap_or(0);

    table.add_row(vec![
        styled_cell("version", Color::Cyan, false),
        styled_cell(
            payload["version"].as_str().unwrap_or("unknown"),
            Color::White,
            true,
        ),
        styled_cell(
            payload["install_surface"].as_str().unwrap_or("unknown"),
            Color::DarkGrey,
            false,
        ),
    ]);
    table.add_row(vec![
        styled_cell("codex_home", Color::Cyan, false),
        styled_cell(
            bool_label(codex_home_exists),
            if codex_home_exists {
                Color::Green
            } else {
                Color::Yellow
            },
            true,
        ),
        styled_cell(
            payload["codex_home"].as_str().unwrap_or(""),
            Color::DarkGrey,
            false,
        ),
    ]);
    table.add_row(vec![
        styled_cell("sessions", Color::Cyan, false),
        styled_cell(
            bool_label(sessions_dir_exists),
            if sessions_dir_exists {
                Color::Green
            } else {
                Color::Yellow
            },
            true,
        ),
        styled_cell(
            payload["sessions_dir"].as_str().unwrap_or(""),
            Color::DarkGrey,
            false,
        ),
    ]);
    table.add_row(vec![
        styled_cell("archived_sessions", Color::Cyan, false),
        styled_cell(
            bool_label(archived_sessions_dir_exists),
            if archived_sessions_dir_exists {
                Color::Green
            } else {
                Color::Yellow
            },
            true,
        ),
        styled_cell(
            payload["archived_sessions_dir"].as_str().unwrap_or(""),
            Color::DarkGrey,
            false,
        ),
    ]);
    table.add_row(vec![
        styled_cell("jsonl_files", Color::Cyan, false),
        styled_cell(
            jsonl_files.to_string(),
            if jsonl_files > 0 {
                Color::Green
            } else {
                Color::Yellow
            },
            true,
        ),
        styled_cell(
            "metadata only; files are not parsed",
            Color::DarkGrey,
            false,
        ),
    ]);
    table.add_row(vec![
        styled_cell("cache", Color::Cyan, false),
        styled_cell(
            if cache_dir_exists { "warm" } else { "empty" },
            Color::White,
            true,
        ),
        styled_cell(
            payload["cache_dir"].as_str().unwrap_or(""),
            Color::DarkGrey,
            false,
        ),
    ]);
    table.add_row(vec![
        styled_cell("pricing", Color::Cyan, false),
        styled_cell(
            format!(
                "{} @ ${:.2}/1000 credits",
                payload["pricing_mode"].as_str().unwrap_or("unknown"),
                payload["usd_per_1000_credits"]
                    .as_f64()
                    .unwrap_or(DEFAULT_USD_PER_1000_CREDITS)
            ),
            Color::White,
            true,
        ),
        styled_cell(
            payload["count_mode"].as_str().unwrap_or("unknown"),
            Color::DarkGrey,
            false,
        ),
    ]);
    table.enforce_styling();
    println!("{}", table_block("Codex Usage Doctor", table));
    Ok(())
}

pub fn build_report_json(options: ReportOptions) -> Result<Value> {
    let args = args_from_options(options, true);
    let report = generate_report(args)?;
    Ok(report_json(&report))
}

pub fn run_cli() -> Result<()> {
    let args = Args::parse();
    let json_output = args.json_output;
    if args.doctor || args.range.as_deref() == Some("doctor") {
        if json_output {
            println!("{}", serde_json::to_string_pretty(&doctor_json(&args)?)?);
        } else {
            print_doctor(&args)?;
        }
        return Ok(());
    }
    let report = generate_report(args)?;
    if json_output {
        println!("{}", serde_json::to_string_pretty(&report_json(&report))?);
    } else {
        print_report(&report);
    }
    Ok(())
}
