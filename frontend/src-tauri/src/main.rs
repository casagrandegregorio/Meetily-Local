#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use env_logger;
use log;
use std::io::Write;

/// Il registro su disco (30-09): i messaggi del motore vanno anche in un file
/// al giorno, `%LOCALAPPDATA%\com.meetily.ai\logs\meetily-AAAA-MM-GG.log`.
/// Prima andavano solo sulla console, che nell'app installata non c'e': dopo
/// un guasto non restava niente da leggere (la chiusura del 30-09 alle 09.17 e'
/// stata ricostruita dalle ore dei file e dal Cestino). Si tengono 14 giorni.
fn registro_su_disco() -> Option<std::fs::File> {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let cartella = base.join("com.meetily.ai").join("logs");
    std::fs::create_dir_all(&cartella).ok()?;
    let limite = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(14 * 24 * 3600));
    if let (Ok(voci), Some(limite)) = (std::fs::read_dir(&cartella), limite) {
        for voce in voci.flatten() {
            let vecchio = voce
                .metadata()
                .and_then(|m| m.modified())
                .map(|t| t < limite)
                .unwrap_or(false);
            if vecchio && voce.file_name().to_string_lossy().starts_with("meetily-") {
                let _ = std::fs::remove_file(voce.path());
            }
        }
    }
    let nome = format!("meetily-{}.log", chrono::Local::now().format("%Y-%m-%d"));
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(cartella.join(nome))
        .ok()
}

/// Scrive sul file e anche sulla console, quando c'e' (in sviluppo).
struct FileEConsole(std::fs::File);

impl Write for FileEConsole {
    fn write(&mut self, dati: &[u8]) -> std::io::Result<usize> {
        let _ = std::io::stderr().write_all(dati);
        self.0.write_all(dati)?;
        Ok(dati.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        let _ = std::io::stderr().flush();
        self.0.flush()
    }
}

fn main() {
    // Honor RUST_LOG from the environment (dev.sh sets `info,whisper_rs=warn`)
    // and default to `info` if unset. The `filter_module` call clamps
    // `whisper_rs` to Warn regardless — whisper.cpp emits ~1000 lines of
    // per-decoder beam-search trace at INFO that drowns out everything else.
    let mut registro =
        env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"));
    registro
        .filter_module("whisper_rs", log::LevelFilter::Warn)
        // l'ora locale, come la leggi sull'orologio (30-09)
        .format(|buf, record| {
            writeln!(
                buf,
                "{} {:<5} {} · {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
                record.level(),
                record.target(),
                record.args()
            )
        });
    if let Some(file) = registro_su_disco() {
        registro.target(env_logger::Target::Pipe(Box::new(FileEConsole(file))));
    }
    registro.init();

    // Un panico del motore finisce anche nel registro (30-09): senza questo
    // andava solo sulla console, cioe' da nessuna parte.
    let di_prima = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("PANICO: {}", info);
        di_prima(info);
    }));

    // On Linux, WebKitGTK's DMABUF renderer is unreliable on common GPU/driver
    // combinations (notably NVIDIA proprietary drivers and several Wayland
    // compositors), producing a blank white window on launch. Disabling DMABUF
    // falls back to the stable renderer and fixes the blank-window case with
    // negligible visual/performance cost for a desktop app of this scope.
    // Only set the flag if the user hasn't already chosen a value, so anyone
    // debugging WebKit rendering can still override it from the environment.
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    // Async logger will be initialized lazily when first needed (after Tauri runtime starts)
    log::info!("Starting application...");
    app_lib::run();
}
