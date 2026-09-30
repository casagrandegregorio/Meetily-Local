//! Il nome della cartella di una registrazione (30-09).
//!
//! Alla partenza la cartella si chiama `30-09-2026 · 09.07`; allo Stop, quando
//! si sa quanto e' durata, diventa `30-09-2026 · 09.07–09.50 · 0h43`. Prima era
//! `Meeting 2026-09-30_09-07-57_2026-09-30_07-07`: la stessa ora due volte, una
//! locale e una di Greenwich, e niente che si leggesse a colpo d'occhio.
//!
//! Niente due punti, perche' Windows non li accetta nei nomi: il punto e'
//! dell'ora, la `h` della durata. Il nome e' una comodita': se non si riesce a
//! darlo, la registrazione resta col nome che ha, e non si perde niente.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Local};

/// Il nome alla partenza: giorno e ora d'inizio.
pub fn all_avvio(inizio: &DateTime<Local>) -> String {
    inizio.format("%d-%m-%Y · %H.%M").to_string()
}

/// Il nome allo Stop: inizio, fine e durata. La fine e' l'inizio piu' la
/// durata; la durata si arrotonda al minuto.
pub fn alla_fine(inizio: &DateTime<Local>, secondi: f64) -> String {
    let secondi = if secondi.is_finite() && secondi > 0.0 { secondi } else { 0.0 };
    let fine = *inizio + chrono::Duration::seconds(secondi as i64);
    let minuti = (secondi / 60.0).round() as i64;
    format!(
        "{}–{} · {}h{:02}",
        all_avvio(inizio),
        fine.format("%H.%M"),
        minuti / 60,
        minuti % 60
    )
}

/// Un posto libero per `nome` dentro `base`: se una cartella con quel nome
/// c'e' gia', ` (2)`, ` (3)`, … Mai sopra una registrazione che esiste.
pub fn libero(base: &Path, nome: &str) -> PathBuf {
    let primo = base.join(nome);
    if !primo.exists() {
        return primo;
    }
    let mut n = 2;
    loop {
        let altro = base.join(format!("{} ({})", nome, n));
        if !altro.exists() {
            return altro;
        }
        n += 1;
    }
}

/// Rinomina `dir` col nome di fine, leggendo inizio e durata dal suo
/// `metadata.json`. Dice dove sta adesso la cartella: quella nuova se e'
/// andata, la stessa se manca qualcosa o Windows non lascia rinominare.
pub fn rinomina_alla_fine(dir: &Path) -> PathBuf {
    match prova_a_rinominare(dir) {
        Ok(nuova) => nuova,
        Err(e) => {
            log::warn!("Cartella {:?} non rinominata: {}", dir, e);
            dir.to_path_buf()
        }
    }
}

fn prova_a_rinominare(dir: &Path) -> Result<PathBuf, String> {
    let testo = std::fs::read_to_string(dir.join("metadata.json")).map_err(|e| e.to_string())?;
    let meta: serde_json::Value = serde_json::from_str(&testo).map_err(|e| e.to_string())?;
    let ora = |campo: &str| {
        meta.get(campo)
            .and_then(|s| s.as_str())
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&Local))
    };
    let inizio = ora("created_at").ok_or_else(|| "manca created_at".to_string())?;
    // `duration_seconds` allo Stop resta vuoto (visto il 30-09: vuoto in tutte
    // le registrazioni normali, lo scrivono solo gli import e le ricomposte):
    // allora la durata e' la distanza fra inizio e fine, come in `riunioni.rs`.
    let secondi = meta
        .get("duration_seconds")
        .and_then(|s| s.as_f64())
        .or_else(|| {
            ora("completed_at")
                .filter(|fine| *fine > inizio)
                .map(|fine| (fine - inizio).num_milliseconds() as f64 / 1000.0)
        })
        .ok_or_else(|| "manca la durata, e anche completed_at".to_string())?;
    let nome = alla_fine(&inizio, secondi);
    if dir.file_name().and_then(|n| n.to_str()) == Some(nome.as_str()) {
        return Ok(dir.to_path_buf());
    }
    let base = dir.parent().ok_or_else(|| "cartella senza genitore".to_string())?;
    let nuova = libero(base, &nome);
    std::fs::rename(dir, &nuova).map_err(|e| e.to_string())?;
    log::info!("Cartella rinominata: {:?} -> {:?}", dir, nuova);
    Ok(nuova)
}
