fn main() {
    if let Err(err) = ut_codex_usage::run_cli() {
        eprintln!("ERROR: {err:#}");
        std::process::exit(1);
    }
}
