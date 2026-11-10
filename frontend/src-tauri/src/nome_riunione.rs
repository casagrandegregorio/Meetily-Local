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
//!
//! Dal 10-11 in coda puo' esserci il progetto: `… · 0h43 · PROGETTO-GAMMA`. La parte
//! con data e ore (la «base») non si tocca mai; cambiare progetto vuol dire
//! togliere l'ultimo pezzo e metterne un altro. Lo stesso conto lo fa l'app
//! (`frontend/src/lib/nome-riunione.ts`): le due letture devono restare uguali.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Local};
use once_cell::sync::Lazy;
use regex::Regex;

const SEP: &str = " · ";

/// Le tre forme di nome che conosciamo, ognuna con la sua parte fissa:
/// quella nuova, `Meeting 2026-07-23_11-34-54_2026-07-23_09-34` e
/// `audio_2026-07-23_10-43`. Il ` (2)` di un doppione fa parte della base.
static FORME: Lazy<[Regex; 3]> = Lazy::new(|| {
    [
        Regex::new(r"^\d{2}-\d{2}-\d{4} · \d{2}\.\d{2}(?:–\d{2}\.\d{2} · \d+h\d{2})?(?: \(\d+\))?").unwrap(),
        Regex::new(r"^Meeting \d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(?: \(\d+\))?").unwrap(),
        Regex::new(r"^audio_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(?: \(\d+\))?").unwrap(),
    ]
});

static DOPPIONE: Lazy<Regex> = Lazy::new(|| Regex::new(r" \(\d+\)$").unwrap());

/// Il nome di una cartella diviso in due: la base e il progetto in coda.
#[derive(Debug, PartialEq)]
pub struct NomeLetto {
    pub base: String,
    pub progetto: Option<String>,
}

/// Come `leggiNome` dell'app: prima le forme conosciute, poi, per un nome
/// che non conosciamo, l'ultimo pezzo dopo « · ».
pub fn leggi(folder: &str) -> NomeLetto {
    for forma in FORME.iter() {
        let Some(m) = forma.find(folder) else { continue };
        let resto = &folder[m.end()..];
        if !resto.is_empty() && !resto.starts_with(SEP) {
            continue;
        }
        let progetto = resto.strip_prefix(SEP).filter(|p| !p.is_empty()).map(str::to_string);
        return NomeLetto { base: m.as_str().to_string(), progetto };
    }
    match folder.rfind(SEP) {
        Some(i) if i > 0 => NomeLetto {
            base: folder[..i].to_string(),
            progetto: Some(folder[i + SEP.len()..].to_string()).filter(|p| !p.is_empty()),
        },
        _ => NomeLetto { base: folder.to_string(), progetto: None },
    }
}

/// Il progetto in coda al nome, se c'e'.
pub fn progetto_di(folder: &str) -> Option<String> {
    leggi(folder).progetto
}

/// Un posto libero in `dentro` per la base `base` col progetto `progetto`:
/// `base · P`, e se c'e' gia' `base (2) · P`, `base (3) · P`… Il numero va
/// prima del progetto, cosi' il nome si rilegge giusto. `attuale` e' il nome
/// che la cartella ha adesso: quello conta come libero.
pub fn posto_libero(dentro: &Path, base: &str, progetto: Option<&str>, attuale: Option<&str>) -> PathBuf {
    let coda = progetto.map(|p| format!("{SEP}{p}")).unwrap_or_default();
    let radice = DOPPIONE.replace(base, "").into_owned();
    let mut nome = format!("{base}{coda}");
    let mut n = 2;
    loop {
        let posto = dentro.join(&nome);
        if Some(nome.as_str()) == attuale || !posto.exists() {
            return posto;
        }
        nome = format!("{radice} ({n}){coda}");
        n += 1;
    }
}

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
    rinomina_alla_fine_con(dir, None)
}

/// Come `rinomina_alla_fine`, col progetto scelto in coda (10-11).
pub fn rinomina_alla_fine_con(dir: &Path, progetto: Option<&str>) -> PathBuf {
    match prova_a_rinominare(dir, progetto) {
        Ok(nuova) => nuova,
        Err(e) => {
            log::warn!("Cartella {:?} non rinominata: {}", dir, e);
            dir.to_path_buf()
        }
    }
}

fn prova_a_rinominare(dir: &Path, progetto: Option<&str>) -> Result<PathBuf, String> {
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
    let attuale = dir.file_name().and_then(|n| n.to_str());
    let base = dir.parent().ok_or_else(|| "cartella senza genitore".to_string())?;
    let nuova = posto_libero(base, &nome, progetto, attuale);
    if nuova == dir {
        return Ok(dir.to_path_buf());
    }
    std::fs::rename(dir, &nuova).map_err(|e| e.to_string())?;
    log::info!("Cartella rinominata: {:?} -> {:?}", dir, nuova);
    Ok(nuova)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legge_base_e_progetto() {
        let n = leggi("10-11-2026 · 09.07–09.50 · 0h43 · PROGETTO-GAMMA");
        assert_eq!(n.base, "10-11-2026 · 09.07–09.50 · 0h43");
        assert_eq!(n.progetto.as_deref(), Some("PROGETTO-GAMMA"));
        assert_eq!(leggi("10-11-2026 · 09.07–09.50 · 0h43").progetto, None);
        assert_eq!(leggi("10-11-2026 · 09.07 (2) · X").base, "10-11-2026 · 09.07 (2)");
        let m = leggi("Meeting 2026-07-23_11-34-54_2026-07-23_09-34 · PROGETTO-DELTA");
        assert_eq!(m.progetto.as_deref(), Some("PROGETTO-DELTA"));
        assert_eq!(leggi("audio_2026-07-23_10-43").progetto, None);
        assert_eq!(leggi("strana · cosa").progetto.as_deref(), Some("cosa"));
    }

    #[test]
    fn il_numero_va_prima_del_progetto() {
        let base = std::env::temp_dir().join(format!("nome-riunione-prova-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("10-11-2026 · 09.07 · P")).unwrap();
        let posto = posto_libero(&base, "10-11-2026 · 09.07", Some("P"), None);
        assert_eq!(posto.file_name().unwrap().to_str(), Some("10-11-2026 · 09.07 (2) · P"));
        let stessa = posto_libero(&base, "10-11-2026 · 09.07", Some("P"), Some("10-11-2026 · 09.07 · P"));
        assert_eq!(stessa.file_name().unwrap().to_str(), Some("10-11-2026 · 09.07 · P"));
        let _ = std::fs::remove_dir_all(&base);
    }
}
