// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `Umi --mcp`: the MCP server for AI agents, over stdin/stdout, with no window.
    if std::env::args().any(|a| a == "--mcp") {
        return umi_mcp::serve();
    }
    umi_desktop_lib::run()
}
