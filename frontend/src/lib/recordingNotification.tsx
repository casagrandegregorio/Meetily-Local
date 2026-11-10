import { toast } from "sonner";

/**
 * L'avviso all'avvio della registrazione: ricordarsi di dire a chi partecipa
 * che la riunione e' registrata.
 *
 * Era il riquadro bianco di Meetily, in inglese, con una casella e un
 * pulsante largo, in basso a destra per dieci secondi. Il 10-11 Greg: «il
 * messaggio sotto non è bello». Adesso e' un avviso scuro come gli altri, in
 * italiano, che sparisce da solo; «Non dirmelo più» lo spegne per sempre
 * (la stessa preferenza di prima, `show_recording_notification`).
 */
export async function showRecordingNotification(): Promise<void> {
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load("preferences.json");
    const showNotification = (await store.get<boolean>("show_recording_notification")) ?? true;
    if (!showNotification) return;

    toast("Sta registrando", {
      description: "Avvisa chi partecipa che la riunione è registrata.",
      duration: 6000,
      action: {
        label: "Non dirmelo più",
        onClick: async () => {
          await store.set("show_recording_notification", false);
          await store.save();
        },
      },
    });
  } catch (notificationError) {
    // l'avviso non deve mai fermare la registrazione
    console.error("Failed to show recording notification:", notificationError);
  }
}
