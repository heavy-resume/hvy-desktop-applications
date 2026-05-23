fn main() {
    if std::env::args().any(|arg| arg == "--mcp-stdio") {
        if let Err(error) = hvy_galaxy_lib::run_mcp_stdio_main() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    hvy_galaxy_lib::run();
}
