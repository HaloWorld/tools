use serde::Serialize;
use std::env;
use std::process::ExitCode;
use ut_list::{command_report, doctor_report, CommandReport, VERSION};

fn print_help() {
    println!("Usage:");
    println!("  ut-list");
    println!("  ut-list --json");
    println!("  ut-list doctor");
    println!("  ut-list doctor --json");
    println!("  ut-list --version");
    println!();
    println!("Lists installed Universal Tools commands with the ut- prefix.");
}

fn print_table(report: &CommandReport) {
    println!("Universal Tools commands");
    println!();

    if report.commands.is_empty() {
        println!("No ut-* commands found next to ut-list.");
        return;
    }

    let name_width = report
        .commands
        .iter()
        .map(|command| command.name.len())
        .max()
        .unwrap_or(7);

    for command in &report.commands {
        println!(
            "  {name:<width$}  {description}",
            name = command.name,
            width = name_width,
            description = command.description
        );
    }

    println!();
    println!("Run '<command> --help' for command details.");
}

fn print_json<T: Serialize>(value: &T) -> Result<(), String> {
    let out = serde_json::to_string_pretty(value)
        .map_err(|err| format!("could not write json: {err}"))?;
    println!("{out}");
    Ok(())
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().skip(1).collect();

    match args.as_slice() {
        [] => print_table(&command_report()?),
        [flag] if flag == "-h" || flag == "--help" => print_help(),
        [flag] if flag == "--version" => println!("ut-list {VERSION}"),
        [flag] if flag == "--json" => print_json(&command_report()?)?,
        [command] if command == "doctor" => {
            let doctor = doctor_report()?;
            println!("ut-list doctor");
            println!("  status: {}", doctor.status);
            println!("  commands: {}", doctor.command_count);
            println!("  self_listed: {}", doctor.self_listed);
        }
        [command, flag] if command == "doctor" && flag == "--json" => {
            print_json(&doctor_report()?)?;
        }
        _ => {
            return Err("usage: ut-list [--json|--version|doctor]".to_string());
        }
    }

    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("ERROR: {err}");
            ExitCode::from(1)
        }
    }
}
